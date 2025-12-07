import type { ReviewerAssignment } from '../services/assignments/csvAssignmentLoader.js';
import type { ManualReviewerAssignment, ReviewerSummary } from './dashboardCoordinator.js';
import type { ReviewerSummaryFile } from './dashboardCoordinator.js';

export class ReviewerSummaryBuilder {
  build(
    reviewersFromCsv: ReviewerAssignment[],
    reviewersManual: ManualReviewerAssignment[],
    missingFiles: string[],
  ): ReviewerSummary[] {
    const missingSet = new Set(missingFiles.map((f) => f.toLowerCase()));
    const grouped = new Map<string, ReviewerSummary>();

    // Process CSV assignments
    for (const assignment of reviewersFromCsv) {
      const file = assignment.file.trim();
      if (!file) continue;

      for (const reviewer of assignment.reviewers) {
        const name = reviewer.trim();
        if (!name) continue;

        if (!grouped.has(name.toLowerCase())) {
          grouped.set(name.toLowerCase(), {
            name,
            files: [],
            hasManual: false,
            hasCsv: false,
            hasMissing: false,
          });
        }

        const summary = grouped.get(name.toLowerCase())!;
        const isMissing = missingSet.has(file.toLowerCase());

        const entry: ReviewerSummaryFile = {
          name: file,
          missing: isMissing,
          manual: false,
          manualIndex: null,
          source: 'csv',
          label: assignment.label ?? file,
        };
        summary.files.push(entry);
        summary.hasCsv = true;
        if (isMissing) summary.hasMissing = true;
      }
    }

    // Process manual assignments
    for (let index = 0; index < reviewersManual.length; index++) {
      const assignment = reviewersManual[index];
      const file = assignment.file.trim();
      if (!file) continue;

      for (const reviewer of assignment.reviewers) {
        const name = reviewer.trim();
        if (!name) continue;

        if (!grouped.has(name.toLowerCase())) {
          grouped.set(name.toLowerCase(), {
            name,
            files: [],
            hasManual: false,
            hasCsv: false,
            hasMissing: false,
          });
        }

        const summary = grouped.get(name.toLowerCase())!;
        const isMissing = missingSet.has(file.toLowerCase());

        const entry: ReviewerSummaryFile = {
          name: file,
          missing: isMissing,
          manual: true,
          manualIndex: index,
          source: 'manual',
          label: assignment.file,
        };
        summary.files.push(entry);
        summary.hasManual = true;
        if (isMissing) summary.hasMissing = true;
      }
    }

    // Sort and return
    const summaries = Array.from(grouped.values());
    summaries.forEach((s) => s.files.sort((a, b) => a.name.localeCompare(b.name)));
    summaries.sort((a, b) => a.name.localeCompare(b.name));

    return summaries;
  }
}
