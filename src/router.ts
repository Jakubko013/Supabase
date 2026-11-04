export const getRoute = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

export function navigate(path: string) {
  window.location.hash = `/${path}`;
}
