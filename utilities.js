function pow2abs(a, b) {
  return Math.pow(Math.abs(a - b), 2);
}

export function distance(touches) {
  const a = touches[0];
  const b = touches[1];

  return Math.sqrt(
    pow2abs(a.pageX, b.pageX) +
    pow2abs(a.pageY, b.pageY),
  2);
}

function toDeg(rad) {
  return rad * 180 / Math.PI;
}

export function angle(touches) {
  const a = touches[0];
  const b = touches[1];
  let deg = toDeg(Math.atan2(b.pageY - a.pageY, b.pageX - a.pageX));
  if (deg < 0) {
    deg += 360;
  }
  return deg;
}
