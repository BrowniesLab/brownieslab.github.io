export const sanitizeName = (name) =>
  name.trim().replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
