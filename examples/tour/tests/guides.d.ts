// the locale of the tour and the meta of its pages: a title, and how pages link up at a branch
declare module "@tailor-platform/e2g" {
  interface Register {
    locales: "en";
    meta: {
      title: string;
      /** The pages a reader can go on to after this one. */
      next?: { label: string; detail: string; slug: string }[];
      /** The page this one branches from. */
      parent?: { slug: string; title: string };
    };
  }
}

export {};
