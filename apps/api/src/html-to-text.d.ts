declare module "html-to-text" {
  export function convert(
    html: string,
    options?: {
      readonly selectors?: readonly {
        readonly format?: string
        readonly options?: { readonly ignoreHref?: boolean }
        readonly selector: string
      }[]
    },
  ): string
}
