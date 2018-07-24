import * as path from 'path';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as mkdirp from 'mkdirp';
import * as logSymbols from 'log-symbols';
import { emojify } from 'node-emoji';
import chalk from 'chalk';
import { PhaseTypes } from '../constants';
import { CLIOptions } from '../../models/options';
import { StoryWithOptions } from '../../models/story';
import inspect = require('util-inspect');
import StoryStore from './StoryStore';
import Terminal from './Terminal';
import Server from './Server';
import Browser from './Browser';
import Page from './Page';
import { humanizeDuration, execParallel } from '../utils';

export default class App {
  private options: CLIOptions;
  private store: StoryStore;
  private terminal: Terminal;
  private server: Server;
  private browsers: Browser[];
  private pages: Page[];
  private startTime: number;

  public constructor(
    options: CLIOptions,
    store: StoryStore,
    terminal: Terminal,
    server: Server,
    browserFactory: (id: number) => Browser,
  ) {
    this.options = options;
    this.store = store;
    this.terminal = terminal;
    this.server = server;
    this.browsers = _.range(this.options.parallel).map(browserFactory);
    this.startTime = Date.now();
  }

  public async validate() {
    const { cmd, cwd, configDir } = this.options;

    this.terminal.log('CLI Options', inspect(this.options));

    if (!fs.existsSync(cmd)) {
      this.terminal.error(`Storybook does not exists. First, let's setup a Storybook!
        See: https://storybook.js.org/basics/quick-start-guide/`);
      return;
    }

    if (!fs.existsSync(path.resolve(cwd, configDir, 'config.js'))) {
      this.terminal.error(`"${configDir}/config.js" does not exists.`);
      return;
    }
  }

  public async launch() {
    this.terminal
      .section('green', PhaseTypes.LAUNCH, 'Launching storybook server ...')
      .blank();

    await Promise.all([
      this.server.start(),
      Promise.all(this.browsers.map(b => b.launch())),
    ]);

    this.pages = await Promise.all(this.browsers.map(b => b.createPage(
      this.server.getURL(),
      (type: string, text: string) => {
        this.terminal.log('BROWSER', `${type}: ${text.trim()}`);
      },
    )));
  }

  public prepare() {
    this.terminal
      .section('cyan', PhaseTypes.PREPARE, 'Fetching the target components ...')
      .blank();

    mkdirp.sync(this.options.outputDir);

    return Promise.all(this.pages.map(p => new Promise<StoryWithOptions[]>(async (resolve, reject) => {
      try {
        p.waitScreenshotStories().then(resolve).catch(reject);
        await p.exposeSetScreenshotStories();
        await p.goto(PhaseTypes.PREPARE);
      } catch (e) {
        reject(e);
      }
    }))).then(storiesList => this.store.set(storiesList.reduce((acc, cur) => [...acc, ...cur], [])));
  }

  public async capture() {
    const stories = this.store.get();
    const parallel = Math.min(stories.length, this.options.parallel);

    this.terminal
      .section('yellow', PhaseTypes.CAPTURE, 'Capturing component screenshots ...')
      .blank()
      .progressStart(emojify(':camera:  [:bar] :current/:total'), stories.length);

    await execParallel(
      parallel,
      stories.map(story => async (workerIndex: number) => {
        await this.pages[workerIndex].screenshot(story);
        this.terminal.progressTick();
      }),
    );

    this.terminal.progressStop();
  }

  public async teardown() {
    this.terminal
      .section('cyan', PhaseTypes.DONE, 'Screenshot image saving is completed!')
      .blank();

    const { outputDir } = this.options;
    const takedStories = this.store.get(false);
    const skippedStories = this.store.get(true);

    takedStories.forEach(({ filename }) => {
      this.terminal.echo(`  ${logSymbols.success}  ${outputDir}/${chalk.bold(filename)}`);
    });

    skippedStories.forEach(({ filename }) => {
      this.terminal.echo(`  ${logSymbols.warning}  ${outputDir}/${chalk.bold(filename)} ${chalk.yellow('(skipped)')}`);
    });

    this.terminal
      .blank(1)
      .echo(`${chalk.bold('Time')}:        ${humanizeDuration(Date.now() - this.startTime)}`)
      .echo(`${chalk.bold('Screenshots')}: ${takedStories.length} total (${skippedStories.length} skipped)`)
      .blank(2);

    await this.terminate();
  }

  public async terminate(e?: Error) {
    if (e) {
      this.terminal.error(`An unexpected error occurred, Please make sure message below\n${e}`);
    }
    this.server.stop();
    await Promise.all(this.browsers.map(b => b.close()));
  }
}
