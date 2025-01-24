type $Strict<T> = {
  [P in keyof T]-?: T[P];
};

export type Viewport = {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  isLandscape?: boolean;
};

export interface ScreenshotOptionFragments {
  delay?: number;
  waitAssets?: boolean;
  waitImages?: boolean; // deprecated. Use `waitAssets`
  waitFor?: string | (() => Promise<any>);
  viewport?: Viewport | string;
  fullPage?: boolean;
  hover?: string;
  focus?: string;
  click?: string;
  skip?: boolean;
  omitBackground?: boolean;
  captureBeyondViewport?: boolean;
  clip?: { x: number; y: number; width: number; height: number } | null;
}

export interface ScreenshotOptionFragmentsForVariant extends ScreenshotOptionFragments {
  extends?: string | string[];
}

/**
 *
 * Represents a root(default) screenshot options.
 *
 **/
export interface ScreenshotOptions extends ScreenshotOptionFragments {
  viewports?: string[] | { [key: string]: string | Viewport };
  variants?: {
    [key: string]: ScreenshotOptionFragmentsForVariant;
  };
  defaultVariantSuffix?: string;
}

export interface StrictScreenshotOptions extends $Strict<ScreenshotOptionFragments> {
  variants: {
    [key: string]: $Strict<ScreenshotOptionFragmentsForVariant>;
  };
  defaultVariantSuffix: string;
}

/**
 *
 * Represents an identifier for a variant.
 *
 * @remarks
 *
 * - If `isDefault` is set, this variant key means the variant is the root(default) variant.
 * - `keys` holds the names of variants in the order closest to root.
 *
 **/
export type VariantKey = {
  isDefault: boolean;
  keys: string[];
};

export interface Exposed {
  emitCapture(opt: ScreenshotOptions, clientStoryKey: string): void;
  getBaseScreenshotOptions(): StrictScreenshotOptions;
  getCurrentVariantKey(): VariantKey;
  waitBrowserMetricsStable(): Promise<void>;
  setViewport(vp: Viewport): Promise<void>;
}
