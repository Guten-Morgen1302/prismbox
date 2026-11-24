import { transformNextClientComponent } from './next-transform';

interface LoaderContext {
  getOptions?: () => Record<string, unknown>;
  query?: Record<string, unknown>;
  resourcePath?: string;
  callback?: (err: null, content?: string, map?: unknown) => void;
}

export default function prismboxNextLoader(this: LoaderContext | void, source: string, map?: unknown) {
  const options = (typeof this?.getOptions === 'function' ? this.getOptions() : this?.query) || {};
  const root = (typeof options.root === 'string' ? options.root : null) || process.cwd();
  const transformed = transformNextClientComponent(source, this?.resourcePath || '', root);
  if (transformed) {
    if (typeof this?.callback === 'function') {
      this.callback(null, transformed.code, transformed.map);
    }
    return transformed.code;
  }
  if (typeof this?.callback === 'function') {
    this.callback(null, source, map);
  }
  return source;
}
