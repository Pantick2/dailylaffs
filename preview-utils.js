function getTeaserClip(width = 800, height = 800) {
  const safeWidth = Math.max(1, Number(width) || 800);
  const safeHeight = Math.max(1, Number(height) || 800);
  return {
    x: 0,
    y: 0,
    width: safeWidth,
    height: Math.floor(safeHeight / 2)
  };
}

module.exports = { getTeaserClip };
