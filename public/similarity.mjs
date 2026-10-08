export function closestProfiles(dimensions, approaches, profile, limit = 3) {
  if (!Array.isArray(dimensions) || dimensions.length === 0) throw new Error('Dimensions are required');
  const ids = dimensions.map(dimension => dimension?.id);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    throw new Error('Dimension IDs must be unique nonempty strings');
  }
  if (!Array.isArray(approaches)) throw new Error('Approaches must be an array');
  if (!Number.isInteger(limit) || limit < 0) throw new Error('Limit must be a nonnegative integer');
  if (!Array.isArray(profile) || profile.length !== ids.length) throw new Error('Every dimension needs a profile score');
  const scores = new Map();
  for (const entry of profile) {
    if (!ids.includes(entry?.id) || scores.has(entry.id)) throw new Error('Profile dimension IDs must match the dimensions');
    scores.set(entry.id, validScore(entry.score, entry.id));
  }
  return approaches.map(approach => ({
    approach,
    gap: ids.reduce((sum, id) => sum + Math.abs(scores.get(id) - validScore(approach?.ratings?.[id]?.score, id)), 0) / ids.length,
  })).sort((a, b) => a.gap - b.gap).slice(0, limit);
}

function validScore(score, id) {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error(`Invalid score for ${id}: expected a number from 0 to 100`);
  return score;
}
