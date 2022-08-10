import moduleAlias from "module-alias";
import { existsSync as checkDirectoryExists } from "fs";
import fs from "fs/promises";
import path from "path";
import fastify from "fastify";
import serveStatic from "serve-static";
import { bootstrap as fastifyDecorators } from "fastify-decorators";
import type { ViteDevServer } from "vite";
import { createServer as createViteServer } from "vite";
import fastifyMiddie from "@fastify/middie";
import { FastifyInstance as FastifyInstance } from "fastify";
import fp from "fastify-plugin";

const root = __dirname;
const pathResolve = (p: string) => path.resolve(root, p);

export type NextFunction = (err?: any) => void;

export interface ServerInstance extends FastifyInstance {
  $app: App;
}

export class App {
  private _web!: FastifyInstance;
  private _vite!: ViteDevServer;
  private _assetDirectory!: string;
  private _isRunning = false;
  private _port!: number;
  private _host!: string;

  private constructor() {
    this._web = fastify({ logger: !this.isProd && !this.isTest });
    this._assetDirectory = this.resolve("assets");
  }

  public resolve(p: string) {
    return pathResolve(p);
  }

  private registerModuleLoader() {
    moduleAlias.addAlias("@root", this.resolve("."));
    moduleAlias.addAlias("@client", this.resolve("./src/client"));
    moduleAlias.addAlias("@server", this.resolve("./src/server"));
    moduleAlias.addAlias("@shared", this.resolve("./src/shared"));
  }

  private async registerMiddlewares() {
    await this._web.register(fastifyMiddie);
  }

  private async startViteServer() {
    this._vite = await createViteServer({
      root,
      server: { middlewareMode: true },
      appType: "custom",
      logLevel: this.isTest ? "error" : "info",
    });
    this._web.use(this._vite.middlewares);
  }

  private async registerAppDecorate() {
    await this._web.register(
      fp((instance: FastifyInstance, options: unknown, done: NextFunction) => {
        instance.decorate("$app", this as App);
        done();
      }),
    );
  }

  private async registerFastifyDecorators() {
    await this._web.register(fastifyDecorators, {
      directory: this.resolve(`src/server/handlers`),
      mask: /\.handler\./,
    });
  }

  private async registerStaticServer() {
    if (checkDirectoryExists(this._assetDirectory)) {
      await this._web.register(require("@fastify/static"), {
        root: this._assetDirectory,
        prefix: "/assets/",
      });
    }

    if (!this.isProd) return;
    // TODO: Find a way to this work with vite brotli compression
    //this._web.use(compression());
    this._web.use(
      serveStatic(this.resolve("dist/client"), {
        index: false,
      }),
    );
  }

  public async up(port = process.env.PORT || 7456, host = process.env.HOST || "0.0.0.0") {
    if (this._isRunning) throw new Error(`Application is already running on port: ${this._port}`);

    this._port = Number(port);
    this._host = host;

    await this._web.listen(this._port, this._host, () => {
      this._isRunning = true;
      console.log(`App is listening on port: ${port}`);
    });
  }

  public get isProd() {
    return process.env.NODE_ENV === "production";
  }

  public get isTest() {
    return process.env.NODE_ENV === "test" || !!process.env.VITE_TEST_BUILD;
  }

  public get vite(): ViteDevServer {
    return this._vite as ViteDevServer;
  }

  public get web(): ServerInstance {
    return this._web as ServerInstance;
  }

  public get port(): number {
    return this.port;
  }

  public get host(): number {
    return this.host;
  }

  public async getStyleSheets(): Promise<string | undefined> {
    const assetpath = this.resolve("dist/assets");
    if (!checkDirectoryExists(assetpath)) return;

    const files = await fs.readdir(assetpath);
    const cssAssets = files.filter(l => l.endsWith(".css"));
    const allContent: string[] = [];

    for (const asset of cssAssets) {
      const content = await fs.readFile(path.join(assetpath, asset), "utf-8");
      allContent.push(`<style type="text/css">${content}</style>`);
    }

    return allContent.join("\n");
  }

  private static _instance: App;

  public static async bootstrap() {
    if (!this._instance) {
      this._instance = new App();
      await this._instance.registerModuleLoader();
      await this._instance.registerMiddlewares();
      await this._instance.startViteServer();
      await this._instance.registerAppDecorate();
      await this._instance.registerFastifyDecorators();
      await this._instance.registerStaticServer();
      // TODO: Find a way to remove this if
      if (!this._instance.isTest) await this._instance.up();
    }

    return this._instance;
  }
}

App.bootstrap();
