import { transformNextClientComponent } from './next-transform';

export default function prismboxNextLoader(this: any, source: string, map: any) {
  const options = (typeof this?.getOptions === 'function' ? this.getOptions() : this?.query) || {};
  const root = options.root || process.cwd();
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
