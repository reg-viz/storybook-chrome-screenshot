import { Story, StorybookServer, StoriesBrowser, createExecutionService, time } from "./story-crawler";
import { CapturingBrowser } from "./capturing-browser";
import { filterStories } from "../util";
import { MainOptions, RunMode } from "./types";
import { FileSystem } from "./file";

async function detectRunMode(storiesBrowser: StoriesBrowser, opt: MainOptions) {
  await storiesBrowser.page.goto(opt.serverOptions.storybookUrl);
  await storiesBrowser.page.waitForNavigation();
  const registered: boolean | undefined = await storiesBrowser.page.evaluate(
    () => (window as any).__STORYCAP_MANAGED_MODE_REGISTERED__,
  );
  const mode: RunMode = registered ? "managed" : "simple";
  opt.logger.log(`Storycap runs with ${mode} mode`);
  return mode;
}

async function bootCapturingBrowsers(opt: MainOptions, mode: RunMode) {
  const browsers = [...new Array(opt.parallel).keys()].map(i => new CapturingBrowser(opt, mode, i));
  await browsers[0].boot();
  await Promise.all(browsers.slice(1, browsers.length).map(b => b.boot()));
  opt.logger.debug(`Started ${browsers.length} capture browsers`);
  return browsers;
}

export async function main(opt: MainOptions) {
  const fileSystem = new FileSystem(opt);

  const storybookServer = new StorybookServer(opt.serverOptions, opt.logger);

  const storiesBrowser = new StoriesBrowser(
    {
      showBrowser: opt.showBrowser,
      storybookUrl: opt.serverOptions.storybookUrl,
    },
    opt.logger,
  );

  await storybookServer.launchIfNeeded();
  await storiesBrowser.boot();

  const allStories = await storiesBrowser.getStories();
  const mode = await detectRunMode(storiesBrowser, opt);
  storiesBrowser.close();

  const stories = filterStories(allStories, opt.include, opt.exclude);

  if (stories.length === 0) {
    opt.logger.warn("There is no matched story. Check your include/exclude options.");
  }

  const workers = await bootCapturingBrowsers(opt, mode);

  const remainingRequestMap = new Map<string, { story: Story; count: number }>();
  stories.forEach(s => remainingRequestMap.set(s.kind + s.story, { story: s, count: 0 }));

  const service = createExecutionService(
    workers,
    remainingRequestMap.values(),
    ({ story, count }, queue) => async storyWorker => {
      storyWorker.setCurrentStory(story);
      const [{ buffer, succeeded }, elapsedTime] = await time(storyWorker.screenshot(count));
      if (!succeeded) return queue.push({ story, count: count + 1 });
      if (buffer) {
        const path = await fileSystem.save(story.kind, story.story, buffer);
        opt.logger.log(`Screenshot stored: ${opt.logger.color.magenta(path)} in ${elapsedTime} msec.`);
      }
      remainingRequestMap.delete(story.kind + story.story);
      if (remainingRequestMap.size === 0) queue.close();
    },
    {
      allowEmpty: true,
    },
  );

  await service.execute();

  if (opt.showBrowser) return;
  await Promise.all(workers.map(b => b.close()));
  storybookServer.shutdown();
}
