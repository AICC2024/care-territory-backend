export function getApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;

  if (configured && configured.trim().length > 0 && configured !== "auto") {
    return configured;
  }

  const protocol = window.location.protocol || "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:5050`;
}
