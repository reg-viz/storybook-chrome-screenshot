import { BaseBrowser, BaseBrowserOptions } from './base-browser';
import { Logger } from '../logger';
import { NoStoriesError, StoriesTimeoutError } from '../errors';
import { Story } from '../story-types';
import { StorybookConnection } from '../storybook-connection';

interface API {
  storyStore?: {
    // available SB v7 or later
    cacheAllCSFFiles: () => Promise<void>;
    cachedCSFFiles?: Record<string, unknown>;
  };
  raw?: () => { id: string; kind: string; name: string }[]; // available SB v5 or later
}

interface PreviewAPI extends API {
  storyStoreValue?: {
    cacheAllCSFFiles: () => Promise<void>;
    cachedCSFFiles?: Record<string, unknown>;
    extract: () => Record<string, { id: string; kind: string; name: string }>; // available in SB v8
  };
}

type ExposedWindow = typeof window & {
  __STORYBOOK_CLIENT_API__?: API;
  // available SB v8 or later
  __STORYBOOK_PREVIEW__?: PreviewAPI;
};

/**
 *
 * Browser class to fetch all stories names.
 *
 **/
export class StoriesBrowser extends BaseBrowser {
  /**
   *
   * @param connection Connected connection to the target Storybook server
   * @param opt Options to launch browser
   * @param logger Logger instance
   *
   **/
  constructor(
    protected connection: StorybookConnection,
    protected opt: BaseBrowserOptions = {},
    protected logger: Logger = new Logger('silent'),
  ) {
    super(opt);
  }

  /**
   *
   * Fetches stories' id, kind and names
   *
   * @returns List of stories
   *
   * @remarks
   * This method automatically detects version of the Storybook.
   *
   **/
  async getStories() {
    this.logger.debug('Wait for stories definition.');
    await this.page.goto(this.connection.url);
    let stories: Story[] | null = null;

    // Note:
    // Don't wait fo this `goto` promise. Sometimes Chromimue emits timeout error and this navigation and causes whole screenshot process abortion.
    // For detail, see https://github.com/reg-viz/storycap/issues/896#issuecomment-2317248668
    this.page.goto(
      this.connection.url + '/iframe.html?selectedKind=story-crawler-kind&selectedStory=story-crawler-story',
    );

    await this.page.waitForFunction(
      () =>
        (window as ExposedWindow).__STORYBOOK_CLIENT_API__ ||
        (window as ExposedWindow).__STORYBOOK_PREVIEW__?.storyStoreValue,
      {
        timeout: 60_000,
      },
    );
    await this.page.evaluate(async () => {
      const api = (window as ExposedWindow).__STORYBOOK_CLIENT_API__ || (window as ExposedWindow).__STORYBOOK_PREVIEW__;
      function isPreviewApi(api: API | PreviewAPI): api is PreviewAPI {
        return (api as PreviewAPI).storyStoreValue !== undefined;
      }
      if (api === undefined) return;

      if (isPreviewApi(api)) {
        return api.storyStoreValue && (await api.storyStoreValue.cacheAllCSFFiles());
      }
      return api.storyStore?.cacheAllCSFFiles && (await api.storyStore.cacheAllCSFFiles());
    });
    const result = await this.page.evaluate(() => {
      function isPreviewApi(api: API | PreviewAPI): api is PreviewAPI {
        return (api as PreviewAPI).storyStoreValue !== undefined;
      }

      return new Promise<{ stories: Story[] | null; timeout: boolean }>(res => {
        const getStories = (count = 0) => {
          const MAX_CONFIGURE_WAIT_COUNT = 4_000;
          const api =
            (window as ExposedWindow).__STORYBOOK_CLIENT_API__ || (window as ExposedWindow).__STORYBOOK_PREVIEW__;
          if (api === undefined) return;

          // for Storybook v7
          const configuringV7store = !isPreviewApi(api) && api.storyStore && !api.storyStore.cachedCSFFiles;
          // for Storybook v8
          const configuringV8store = isPreviewApi(api) && api.storyStoreValue && !api.storyStoreValue.cachedCSFFiles;

          if (configuringV7store || configuringV8store) {
            if (count < MAX_CONFIGURE_WAIT_COUNT) {
              setTimeout(() => getStories(++count), 16);
            } else {
              res({ stories: null, timeout: true });
            }
            return;
          }
          const stories = (
            isPreviewApi(api) && api.storyStoreValue
              ? Object.values(api.storyStoreValue.extract())
              : api.raw
                ? api.raw()
                : []
          ).map(_ => ({ id: _.id, kind: _.kind, story: _.name, version: 'v5' }) as Story);
          res({ stories, timeout: false });
        };
        getStories();
      });
    });
    if (result.timeout) {
      throw new StoriesTimeoutError();
    }
    stories = result.stories;
    if (!stories) {
      throw new NoStoriesError();
    }
    this.logger.debug(stories);
    return stories;
  }
}
