import "@testing-library/jest-dom/vitest"

const matchMedia = (query: string) => ({
  addEventListener: () => undefined,
  addListener: () => undefined,
  dispatchEvent: () => false,
  matches: query.includes("min-width") && !query.includes("max-width"),
  media: query,
  onchange: null,
  removeEventListener: () => undefined,
  removeListener: () => undefined,
})

Object.defineProperty(window, "matchMedia", {
  value: matchMedia,
  writable: true,
})

const getComputedStyle = window.getComputedStyle.bind(window)
Object.defineProperty(window, "getComputedStyle", {
  value: (element: Element) => getComputedStyle(element),
  writable: true,
})

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub
}

if (typeof window.scrollTo !== "function") {
  Object.defineProperty(window, "scrollTo", {
    value: () => undefined,
    writable: true,
  })
}
