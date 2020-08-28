const fs = require('fs').promises;
const path = require('path');
const Router = require('koa-router');
const wechat_event = require('co-wechat');
const wechat_api = require('co-wechat-api');
const wechat_oauth = require('co-wechat-oauth');
const tenpay = require('tenpay');
const LRU = require('lru-cache');
const Cache = require('node-cache');
const uuid = require('uuid');

const token_dir = path.join(__dirname, '../.cache/access_tokens');
const cache = new LRU({ max: 1000, maxAge: 1000 * 7200 });
const openid_tokens = new Cache({ stdTTL: 7200, checkperiod: 60, useClones: false });

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
    this._config = new Map();
    this._event = new Map();
    this._oauth = new Map();
    this._api = new Map();
    this._tenpay = new Map();

    Object.keys(config).forEach(name => {
      let item = config[name];
      // 配置信息
      this._config.set(item.appid, item);

      // 消息回调接口
      if (item.handler) {
        this._event.set(item.appid, wechat_event(item, item.debug).middleware(item.handler));
      }

      // 支付接口
      if (item.mchid && item.partnerKey) {
        this._tenpay.set(item.appid, new tenpay(item, item.debug));
      }

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

  config(appid) {
    return this._config.get(appid);
  }

  oauth(appid) {
    return this._oauth.get(appid);
  }

  api(appid) {
    return this._api.get(appid);
  }

  tenpay(appid) {
    return this._tenpay.get(appid);
  }

  middleware() {
    const router = new Router();

    /**
     * 腾讯服务器消息推送接口
     */
    router.all('/wechat/event/:appid', async (ctx, next) => {
      const fn = this._event.get(ctx.params.appid);
      if (!fn) throw Error('appid对应的消息处理不存在');
      await fn(ctx, next);
    });

    /**
     * 微信支付结果通知接口
     */
    router.all('/wechat/tenpay/:appid', async (ctx, next) => {
      const pay = this._tenpay.get(ctx.params.appid);
      if (!pay) throw Error('appid对应的支付信息不存在');
      const fn = pay.middleware('pay');
      await fn(ctx, next);
    }, async (ctx, next) => {
      const config = this._config.get(ctx.params.appid);
      if (config.onPay) {
        await config.onPay(ctx, next);
      } else {
        ctx.reply("appid对应的onPay处理函数不存在");
      }
    });

    /**
     * 公众号网页授权
     * 
     * @param redirect_uri {string} 获取到用户信息并建立会话后的跳转地址, 请使用encodeURIComponent编码
     * @example GET: /wechat/oauth/{appid}?redirect_uri=%2Findex.html&scope=snsapi_base
     */
    router.get('/wechat/oauth/:appid', async (ctx) => {
      const client = this._oauth.get(ctx.params.appid);
      if (!client) throw Error('appid对应的公众号信息不存在');

      let redirect_uri = ctx.query.redirect_uri;
      if (!redirect_uri) throw Error('缺失redirect_uri参数');

      if (ctx.query.code) {
        // 得到用户授权, 附加用户信息后重定向
        let token = await client.getAccessToken(ctx.query.code);
        let openid_token = uuid.v1().replace(/-/g, '');
        openid_tokens.set(openid_token, { appid: ctx.params.appid, openid: token.data.openid });
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
      if (openid_token != null) {
        let val = openid_tokens.get(openid_token);
        if (val) {
          ctx.appid = val.appid;
          ctx.openid = val.openid;
          openid_tokens.ttl(openid_token);
        }
      }
      await router.routes()(ctx, next);
    };
  }
}

module.exports = Wechat;