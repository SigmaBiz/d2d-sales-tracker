import { Knock } from '../types';

export interface KnockChanges {
  added: Knock[];
  updated: Knock[];
  removed: string[]; // Just IDs for removed knocks
  hasChanges: boolean;
}

export function calculateKnockChanges(
  previousKnocks: Knock[],
  currentKnocks: Knock[]
): KnockChanges {
  const changes: KnockChanges = {
    added: [],
    updated: [],
    removed: [],
    hasChanges: false
  };

  // Create maps for efficient lookup
  const prevMap = new Map<string, Knock>();
  const currMap = new Map<string, Knock>();

  previousKnocks.forEach(knock => prevMap.set(knock.id, knock));
  currentKnocks.forEach(knock => currMap.set(knock.id, knock));

  // Find added and updated knocks
  currentKnocks.forEach(currentKnock => {
    const previousKnock = prevMap.get(currentKnock.id);
    
    if (!previousKnock) {
      // This is a new knock
      changes.added.push(currentKnock);
      changes.hasChanges = true;
    } else if (hasKnockChanged(previousKnock, currentKnock)) {
      // This knock has been updated
      changes.updated.push(currentKnock);
      changes.hasChanges = true;
    }
  });

  // Find removed knocks
  previousKnocks.forEach(prevKnock => {
    if (!currMap.has(prevKnock.id)) {
      changes.removed.push(prevKnock.id);
      changes.hasChanges = true;
    }
  });

  return changes;
}

function hasKnockChanged(knock1: Knock, knock2: Knock): boolean {
  // Check all relevant fields for changes
  return (
    knock1.outcome !== knock2.outcome ||
    knock1.notes !== knock2.notes ||
    knock1.address !== knock2.address ||
    knock1.latitude !== knock2.latitude ||
    knock1.longitude !== knock2.longitude ||
    knock1.syncStatus !== knock2.syncStatus ||
    // Check if history length changed (simple check)
    (knock1.history?.length || 0) !== (knock2.history?.length || 0)
  );
}