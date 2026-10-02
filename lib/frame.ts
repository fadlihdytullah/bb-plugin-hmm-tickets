export type Size = { width: number; height: number };

export const MIN_SIZE: Size = { width: 300, height: 340 };

const PREFERRED: Size = { width: 420, height: 580 };
const MAX_FRACTION = 0.9;
const GUTTER = 32;
const STORAGE_KEY = "hmm-tickets:size";

export function maxSize(viewportWidth: number, viewportHeight: number): Size {
  return {
    width: Math.max(MIN_SIZE.width, Math.round(viewportWidth * MAX_FRACTION)),
    height: Math.max(
      MIN_SIZE.height,
      Math.round(viewportHeight * MAX_FRACTION),
    ),
  };
}

export function clampSize(
  size: Size,
  viewportWidth: number,
  viewportHeight: number,
): Size {
  const max = maxSize(viewportWidth, viewportHeight);
  return {
    width: Math.min(
      Math.max(Math.round(size.width), MIN_SIZE.width),
      max.width,
    ),
    height: Math.min(
      Math.max(Math.round(size.height), MIN_SIZE.height),
      max.height,
    ),
  };
}

export function defaultSize(
  viewportWidth: number,
  viewportHeight: number,
): Size {
  return clampSize(
    {
      width: Math.min(PREFERRED.width, viewportWidth - GUTTER),
      height: Math.min(PREFERRED.height, viewportHeight - GUTTER),
    },
    viewportWidth,
    viewportHeight,
  );
}

export function loadSize(viewportWidth: number, viewportHeight: number): Size {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<Size>;
      if (
        typeof parsed.width === "number" &&
        typeof parsed.height === "number"
      ) {
        return clampSize(
          { width: parsed.width, height: parsed.height },
          viewportWidth,
          viewportHeight,
        );
      }
    }
  } catch {
    return defaultSize(viewportWidth, viewportHeight);
  }
  return defaultSize(viewportWidth, viewportHeight);
}

export function saveSize(size: Size): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(size));
  } catch {
    return;
  }
}
