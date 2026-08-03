function normalizeJokeText(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isUniqueJoke(candidate, existingMemes = []) {
  const normalizedCandidate = normalizeJokeText(`${candidate.title || ''} ${candidate.body || ''} ${candidate.closing || ''}`);

  return !existingMemes.some((meme) => {
    const normalizedExisting = normalizeJokeText(`${meme.title || ''} ${meme.body || ''} ${meme.closing || ''}`);
    return normalizedExisting && normalizedCandidate && normalizedExisting === normalizedCandidate;
  });
}

module.exports = {
  normalizeJokeText,
  isUniqueJoke
};
