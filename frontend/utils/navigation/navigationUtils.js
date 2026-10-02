// src/utils/navigationUtils.js

/**
 * 두 지점 간의 거리를 미터 단위로 계산
 */
export function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 지구 반경 (미터)
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 도(degree)를 라디안(radian)으로 변환
 */
export function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * 라디안(radian)을 도(degree)로 변환
 */
export function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

/**
 * 각도를 0-360도 범위로 정규화
 */
export function normalizeAngle(deg) {
  return (deg % 360 + 360) % 360;
}

/**
 * 두 지점 간의 방위각 계산
 */
export function getBearing(lat1, lon1, lat2, lon2) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  return normalizeAngle(toDeg(Math.atan2(y, x)));
}

/**
 * 방위각을 사용자 친화적인 방향 안내로 변환
 */
export function angleToInstruction(angle) {
  const a = normalizeAngle(angle);
  if (a <= 10 || a >= 350) return '정면';
  if (a < 45) return '조금 오른쪽';
  if (a < 135) return '오른쪽';
  if (a < 225) return '뒤쪽';
  if (a < 315) return '왼쪽';
  return '조금 왼쪽';
}
