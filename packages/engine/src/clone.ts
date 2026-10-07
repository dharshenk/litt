// structuredClone is a runtime global in Node 17+ and all modern browsers, but the
// ES2022 lib this package compiles against doesn't declare it.
declare function structuredClone<T>(value: T): T;

export function clone<T>(value: T): T {
  return structuredClone(value);
}
