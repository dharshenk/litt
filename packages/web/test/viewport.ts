// jsdom has no matchMedia. The app only asks about the phone breakpoint, so a flag is enough.
let mobile = false;

export const setMobile = (value: boolean): void => {
  mobile = value;
};

export const resetViewport = (): void => {
  mobile = false;
};

export function installViewport(): void {
  window.matchMedia = ((query: string) => ({
    matches: /max-width/.test(query) ? mobile : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
