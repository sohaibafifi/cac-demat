#!/usr/bin/env node

const path = require('path');
const { rm } = require('fs/promises');
const { performance } = require('perf_hooks');
const { pathToFileURL } = require('url');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_FIXTURE_ROOT = path.join(ROOT_DIR, 'test-data', 'generated', 'performance-40c-20m-20r');

const parseArgs = (argv) => {
  const options = {
    fixture: DEFAULT_FIXTURE_ROOT,
    source: null,
    membersCsv: null,
    output: null,
    collection: 'Bench',
    limit: 4,
    zip: false,
    keepOutput: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    switch (value) {
      case '--fixture':
        options.fixture = path.resolve(ROOT_DIR, argv[++index]);
        break;
      case '--source':
        options.source = path.resolve(ROOT_DIR, argv[++index]);
        break;
      case '--members-csv':
        options.membersCsv = path.resolve(ROOT_DIR, argv[++index]);
        break;
      case '--output':
        options.output = path.resolve(ROOT_DIR, argv[++index]);
        break;
      case '--collection':
        options.collection = argv[++index];
        break;
      case '--limit':
        options.limit = Number.parseInt(argv[++index], 10);
        break;
      case '--zip':
        options.zip = true;
        break;
      case '--keep-output':
        options.keepOutput = true;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error(`Invalid --limit value: ${options.limit}`);
  }

  return options;
};

const formatMs = (value) => `${value.toFixed(1)} ms`;

const printHumanSummary = (summary) => {
  console.log(`Fixture: ${summary.fixtureRoot}`);
  console.log(`Members tested: ${summary.membersTested}/${summary.membersAvailable}`);
  console.log(`Processed files: ${summary.stats.processedFiles}`);
  console.log(`Zip enabled: ${summary.zipEnabled ? 'yes' : 'no'}`);
  console.log(`Inventory: ${formatMs(summary.timings.inventoryMs)}`);
  console.log(`CSV load: ${formatMs(summary.timings.assignmentLoadMs)}`);
  console.log(`Prepare: ${formatMs(summary.timings.prepareMs)}`);
  console.log(`Wall time total: ${formatMs(summary.timings.totalMs)}`);
  console.log(`Zip total: ${formatMs(summary.timings.zipMs)}`);
  console.log('Note: stage timings are cumulative call times; shared-cache stages can exceed wall time.');
  console.log('');

  const table = summary.stages.map((stage) => ({
    stage: stage.name,
    calls: stage.calls,
    unique_inputs: stage.uniqueInputs,
    reused_calls: stage.reusedCalls,
    total_ms: stage.totalMs.toFixed(1),
    first_seen_ms: stage.uniqueTotalMs.toFixed(1),
    avg_ms: stage.avgMs.toFixed(1),
    max_ms: stage.maxMs.toFixed(1),
    max_file: stage.maxLabel,
  }));

  console.table(table);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const fixtureRoot = options.fixture;
  const sourceDir = options.source ?? path.join(fixtureRoot, 'source');
  const membersCsv = options.membersCsv ?? path.join(fixtureRoot, 'imports', 'members', 'members_all_files.csv');
  const outputDir = options.output ?? path.join(fixtureRoot, `profiling-output-${Date.now()}`);

  const importModule = async (relativePath) =>
    import(pathToFileURL(path.join(ROOT_DIR, relativePath)).href);

  const [
    { CsvAssignmentLoader },
    { PdfPackageProcessor },
    { PdfProcessingPipeline },
    { DocxConversionStage },
    { CleanStage },
    { WatermarkStage },
    { MetadataStage },
    { RestrictionStage },
    { QpdfCommandResolver },
    { PasswordGenerator },
    { MemberPreparationService },
    { ZipService },
  ] = await Promise.all([
    importModule('dist/services/assignments/csvAssignmentLoader.js'),
    importModule('dist/services/pdf/pdfPackageProcessor.js'),
    importModule('dist/services/pipeline/pdfProcessingPipeline.js'),
    importModule('dist/services/pipeline/stages/docxConversionStage.js'),
    importModule('dist/services/pipeline/stages/cleanStage.js'),
    importModule('dist/services/pipeline/stages/watermarkStage.js'),
    importModule('dist/services/pipeline/stages/metadataStage.js'),
    importModule('dist/services/pipeline/stages/restrictionStage.js'),
    importModule('dist/services/pdf/qpdfCommandResolver.js'),
    importModule('dist/support/security/passwordGenerator.js'),
    importModule('dist/services/pipeline/memberPreparationService.js'),
    importModule('dist/services/zip/zipService.js'),
  ]);

  const timings = {
    inventoryMs: 0,
    assignmentLoadMs: 0,
    prepareMs: 0,
    totalMs: 0,
    zipMs: 0,
  };
  const stageTimings = new Map();
  const addStageTiming = (name, elapsedMs, label, inputKey) => {
    const entry = stageTimings.get(name) ?? {
      name,
      calls: 0,
      uniqueInputs: 0,
      reusedCalls: 0,
      totalMs: 0,
      uniqueTotalMs: 0,
      maxMs: 0,
      maxLabel: '',
      seenInputs: new Set(),
    };

    entry.calls += 1;
    entry.totalMs += elapsedMs;

    if (entry.seenInputs.has(inputKey)) {
      entry.reusedCalls += 1;
    } else {
      entry.seenInputs.add(inputKey);
      entry.uniqueInputs += 1;
      entry.uniqueTotalMs += elapsedMs;
    }

    if (elapsedMs > entry.maxMs) {
      entry.maxMs = elapsedMs;
      entry.maxLabel = label;
    }

    stageTimings.set(name, entry);
  };

  const wrapStage = (stage) => {
    const name = stage.constructor?.name ?? 'AnonymousStage';
    const wrapper = {
      async process(context, logger, abortSignal) {
        const inputKey = context.workingPath;
        const startedAt = performance.now();

        try {
          return await stage.process(context, logger, abortSignal);
        } finally {
          addStageTiming(
            name,
            performance.now() - startedAt,
            `${context.recipient} :: ${context.relativePath}`,
            inputKey,
          );
        }
      },
    };

    if (typeof stage.disposeSharedResources === 'function') {
      wrapper.disposeSharedResources = () => stage.disposeSharedResources();
    }

    return wrapper;
  };

  class ProfilingZipService extends ZipService {
    async zipAll(targets, zipOptions) {
      const startedAt = performance.now();

      try {
        return await super.zipAll(targets, zipOptions);
      } finally {
        timings.zipMs += performance.now() - startedAt;
      }
    }
  }

  const startedAt = performance.now();
  const resolver = new QpdfCommandResolver();
  const passwordGenerator = new PasswordGenerator();
  const pipeline = new PdfProcessingPipeline([
    wrapStage(new DocxConversionStage()),
    wrapStage(new CleanStage(resolver)),
    wrapStage(new WatermarkStage(resolver)),
    wrapStage(new MetadataStage(resolver)),
    wrapStage(new RestrictionStage(resolver, passwordGenerator)),
  ]);

  const packageProcessor = new PdfPackageProcessor(pipeline);
  const loader = new CsvAssignmentLoader();

  const inventoryStartedAt = performance.now();
  const inventory = await packageProcessor.collectPdfFiles(sourceDir);
  timings.inventoryMs = performance.now() - inventoryStartedAt;

  const assignmentStartedAt = performance.now();
  const assignments = await loader.members(
    membersCsv,
    inventory.map((entry) => entry.relative),
  );
  timings.assignmentLoadMs = performance.now() - assignmentStartedAt;

  const subset = assignments.slice(0, options.limit).map((entry) => ({
    name: entry.name,
    files: entry.files,
  }));

  packageProcessor.collectPdfFiles = async () => inventory;

  const memberService = new MemberPreparationService(packageProcessor, new ProfilingZipService());

  try {
    const prepareStartedAt = performance.now();
    const stats = await memberService.prepare(
      subset,
      sourceDir,
      outputDir,
      options.collection,
      undefined,
      undefined,
      undefined,
      options.zip,
    );
    timings.prepareMs = performance.now() - prepareStartedAt;
    timings.totalMs = performance.now() - startedAt;

    const stages = Array.from(stageTimings.values())
      .map((entry) => ({
        name: entry.name,
        calls: entry.calls,
        uniqueInputs: entry.uniqueInputs,
        reusedCalls: entry.reusedCalls,
        totalMs: entry.totalMs,
        uniqueTotalMs: entry.uniqueTotalMs,
        maxMs: entry.maxMs,
        maxLabel: entry.maxLabel,
        avgMs: entry.calls > 0 ? entry.totalMs / entry.calls : 0,
      }))
      .sort((left, right) => right.totalMs - left.totalMs);

    const summary = {
      fixtureRoot,
      sourceDir,
      membersCsv,
      outputDir,
      zipEnabled: options.zip,
      keptOutput: options.keepOutput,
      membersAvailable: assignments.length,
      membersTested: subset.length,
      stats,
      timings,
      stages,
    };

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printHumanSummary(summary);
    }
  } finally {
    if (!options.keepOutput) {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
