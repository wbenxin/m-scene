const fs = require('fs').promises;
const path = require('path');
const Router = require('koa-router');
const wechat_event = require('co-wechat');
const wechat_api = require('co-wechat-api');
const wechat_oauth = require('co-wechat-oauth');
const LRU = require('lru-cache');
const Cache = require('node-cache');
const uuid = require('uuid');

const token_dir = path.join(__dirname, '../.cache/access_tokens');
const cache = new LRU({ max: 1000, maxAge: 1000 * 7200 });
const openid_tokens = new Cache({ stdTTL: 1200, checkperiod: 60, useClones: false });

/**
 * 公众号封装: 事件/OAuth/API
 * 
 * ```
 * const Wechat = require('wechat');
 * const wechat = new Wechat(config);
 * <koa_app>.use(wechat.middleware());
 * ```
 */
class Wechat {
  /**
   * 初始化对象实例
   * @param {{'name': {'appid', 'secret', 'token', 'encodingAESKey', 'handler'}}} config 公众号配置
   */
  constructor(config = {}) {
    this._event = new Map();
    this._oauth = new Map();
    this._api = new Map();

    Object.keys(config).forEach(name => {
      let item = config[name];
      // 消息回调接口
      this._event.set(item.appid, wechat_event(item).middleware(item.handler));

      // 网页授权
      this._oauth.set(item.appid, new wechat_oauth(item.appid, item.secret, async function (openid) {
        let file = path.join(token_dir, openid);
        try {
          let txt = await fs.readFile(file, 'utf8');
          return JSON.parse(txt);
        } catch (e) {
          return null;
        }
      }, async function (openid, token) {
        let file = path.join(token_dir, openid);
        await fs.writeFile(file, JSON.stringify(token));
      }));

      this._api.set(item.appid, new wechat_api(item.appid, item.secret, async () => {
        let file = path.join(token_dir, item.appid);
        try {
          let txt = await fs.readFile(file, 'utf8');
          return JSON.parse(txt);
        } catch (e) {
          return null;
        }
      }, async (token) => {
        let file = path.join(token_dir, item.appid);
        await fs.writeFile(file, JSON.stringify(token));
      }));
    });
  }

  oauth(appid) {
    return this._oauth.get(appid);
  }

  api(appid) {
    return this._api.get(appid);
  }

  middleware() {
    const router = new Router();

    /**
     * 腾讯服务器消息推送接口
     */
    router.all('/wechat/event/:appid', async (ctx, next) => {
      const fn = this._event.get(ctx.params.appid);
      if (!fn) throw Error('appid对应的公众号信息不存在');
      await fn(ctx, next);
    });

    /**
     * 公众号网页授权
     * 
     * @param redirect_uri {string} 获取到用户信息并建立会话后的跳转地址, 请使用encodeURIComponent编码
     * @example GET: /wechat/oauth/{appid}?redirect_uri=%2Findex.html&scope=snsapi_base
     */
    router.get('/wechat/oauth/:appid', async (ctx, next) => {
      const client = this._oauth.get(ctx.params.appid);
      if (!client) throw Error('appid对应的公众号信息不存在');

      let redirect_uri = ctx.query.redirect_uri;
      if (!redirect_uri) throw Error('缺失redirect_uri参数');

      if (ctx.query.code) {
        // 得到用户授权, 附加用户信息后重定向
        let token = await client.getAccessToken(ctx.query.code);
        let openid_token = uuid.v1().replace(/-/g, '');
        openid_tokens.set(openid_token, token.data.openid);
        ctx.cookies.set('m:openid', openid_token, {
          httpOnly: true,
          overwrite: false,
          signed: true,
        });
        ctx.response.redirect(redirect_uri);
      } else {
        // 重定向到授权地址
        let url = cache.get(ctx.href);
        if (url) {
          ctx.response.redirect(url);
        } else {
          let scope = ctx.query.scope || 'snsapi_base';
          let url = client.getAuthorizeURL(ctx.href, 'm-scene', scope);
          cache.set(ctx.href, url);
          ctx.response.redirect(url);
        }
      }
    });

    return async (ctx, next) => {
      ctx.wechat = this;
      let openid_token = ctx.cookies.get('m:openid');
      ctx.openid = openid_tokens.get(openid_token);
      openid_tokens.ttl(openid_token);
      await router.routes()(ctx, next);
    };
  }
}

module.exports = Wechat;