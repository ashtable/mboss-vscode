/**
 * The `data-*` attributes a component is asked to
 * carry.
 *
 * Every shared component takes one of these. The
 * specs and the end-to-end journeys find things on a
 * page by the hooks the views put on them, and a
 * view that hands its markup over to a shared
 * component has nowhere else to put one — so the
 * component passes them through rather than owning
 * the list.
 */
export function hooked(
  hook: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(hook ?? {}).map(([name, value]) => [`data-${name}`, value]),
  );
}
