import type { ReviewerAssignment } from '../services/assignments/csvAssignmentLoader.js';
import type { ManualReviewerAssignment, ReviewerSummary, ReviewerSummaryFile } from './dashboardCoordinator.js';

export class ReviewerSummaryBuilder {
  build(
    reviewersFromCsv: ReviewerAssignment[],
    reviewersManual: ManualReviewerAssignment[],
    missingFiles: string[],
  ): ReviewerSummary[] {
    const missingLookup = new Set(missingFiles.map((file) => file.toLowerCase()));
    const grouped = new Map<string, ReviewerSummary>();

    // Process CSV assignments
    reviewersFromCsv.forEach((assignment) => {
      const file = assignment.file.trim();
      if (file) {
        assignment.reviewers
          .filter((name) => name.trim())
          .forEach((reviewer) => {
            this.addAssignment(grouped, reviewer.trim(), file, 'csv', null, missingLookup);
          });
      }
    });

    // Process manual assignments
    reviewersManual.forEach((assignment, index) => {
      const file = assignment.file.trim();
      if (file) {
        assignment.reviewers
          .filter((name) => name.trim())
          .forEach((reviewer) => {
            this.addAssignment(grouped, reviewer.trim(), file, 'manual', index, missingLookup);
          });
      }
    });

    return this.sortAndFinalize(grouped);
  }

  private addAssignment(
    grouped: Map<string, ReviewerSummary>,
    reviewer: string,
    file: string,
    source: 'csv' | 'manual',
    manualIndex: number | null,
    missingLookup: Set<string>,
  ): void {
    const normalisedReviewer = reviewer.toLowerCase();

    if (!grouped.has(normalisedReviewer)) {
      grouped.set(normalisedReviewer, {
        name: reviewer,
        files: [],
        hasManual: false,
        hasCsv: false,
        hasMissing: false,
      });
    }

    const summary = grouped.get(normalisedReviewer)!;
    const isMissing = missingLookup.has(file.toLowerCase());

    summary.files.push({
      name: file,
      missing: isMissing,
      manual: source === 'manual',
      manualIndex,
      source,
    });

    if (source === 'manual') summary.hasManual = true;
    if (source === 'csv') summary.hasCsv = true;
    if (isMissing) summary.hasMissing = true;
  }

  private sortAndFinalize(grouped: Map<string, ReviewerSummary>): ReviewerSummary[] {
    const summaries = Array.from(grouped.values());

    summaries.forEach((summary) => {
      summary.files.sort((a, b) => a.name.localeCompare(b.name));
    });

    summaries.sort((a, b) => a.name.localeCompare(b.name));

    return summaries;
  }
}

