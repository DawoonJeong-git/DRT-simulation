export function isInactiveRouteStatus(status) {
  if (status == null || status === "") return false;

  const numericStatus = Number(status);
  if (!Number.isFinite(numericStatus)) return false;

  return numericStatus >= 400 && numericStatus < 500;
}

export function isActiveRouteStatus(routeOrStatus) {
  const status =
    routeOrStatus && typeof routeOrStatus === "object"
      ? routeOrStatus.routeStatus ?? routeOrStatus.route_status ?? routeOrStatus.RouteStatus
      : routeOrStatus;

  return !isInactiveRouteStatus(status);
}
