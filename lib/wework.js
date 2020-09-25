const fs = require('fs').promises;
const path = require('path');
const { promisify } = require("util");
const Router = require('koa-router');
const wework_event = require('./wework.event');
const wework_api = require('@wbenxin/co-wechat-enterprise-api');
const Cache = require('node-cache');
const uuid = require('uuid');

const EXPIRE_SECONDS = 1200; // 20分钟过期

const token_dir = path.join(__dirname, '../.cache/access_tokens');
const userid_tokens = new Cache({ stdTTL: EXPIRE_SECONDS, checkperiod: 60, useClones: false });

/**
 * 企业号封装: 事件/OAuth/API
 * 
 * ```
 * const Wework = require('wework');
 * <koa_app>.use(new Wework(config).middleware());
 * ```
 */
class Wework {
  /**
   * 初始化对象实例
   * @param {{name: {'appid', 'agents': [{'agentid', 'name', 'secret', 'token', 'encodingAESKey', 'handler'}] }}} config 企业微信号配置
   */
  constructor(config = {}) {
    this._config = new Map();
    this._event = new Map();
    this._api = new Map();

    Object.keys(config).forEach(name => {
      let { appid, agents } = config[name];
      agents.forEach(agent => {
        // 配置信息
        this._config.set(appid + '-' + agent.agentid, agent);

        // 消息回调接口
        if (agent.token) {
          this._event.set(appid + '-' + agent.agentid, wework_event({
            appid,
            token: agent.token,
            encodingAESKey: agent.encodingAESKey
          }, agent.debug).middleware(agent.handler));
        }

        let api = new wework_api(appid, agent.secret, agent.agentid, async () => {
          let file = path.join(token_dir, appid + '-' + agent.agentid);
          try {
            let txt = await fs.readFile(file, 'utf8');
            return JSON.parse(txt);
          } catch (e) {
            return null;
          }
        }, async (token) => {
          let file = path.join(token_dir, appid + '-' + agent.agentid);
          await fs.writeFile(file, JSON.stringify(token));
        });
        // 持久化jsapi_ticket
        api.registerTicketHandle(async (type) => {
          let file = path.join(token_dir, appid + '-' + type);
          try {
            let txt = await fs.readFile(file, 'utf8');
            return JSON.parse(txt);
          } catch (e) {
            return null;
          }
        }, async (type, ticket) => {
          let file = path.join(token_dir, appid + '-' + type);
          await fs.writeFile(file, JSON.stringify(ticket));
        });
        this._api.set(appid + '-' + agent.agentid, api);
      });
    });
  }

  config(appid, agentid) {
    return this._config.get(appid + '-' + agentid);
  }

  oauth(appid, agentid) {
    return this._api.get(appid + '-' + agentid);
  }

  api(appid, agentid) {
    return this._api.get(appid + '-' + agentid);
  }

  middleware() {
    const router = new Router();

    /**
     * 腾讯服务器消息推送接口
     */
    router.all('/wework/event/:appid/:agentid', async (ctx, next) => {
      const fn = this._event.get(ctx.params.appid + '-' + ctx.params.agentid);
      if (!fn) throw Error('appid对应的公众号信息不存在');
      ctx.query.encrypt_type = 'aes';
      await fn(ctx, next);
      console.log(ctx.body);
    });

    /**
     * 公众号网页授权
     * 
     * @param redirect_uri {string} 获取到用户信息并建立会话后的跳转地址, 请使用encodeURIComponent编码
     * @example GET: /wework/oauth/{appid}/{agentid}?redirect_uri=%2Findex.html
     */
    router.get('/wework/oauth/:appid/:agentid', async (ctx, next) => {
      const client = this._api.get(ctx.params.appid + '-' + ctx.params.agentid);
      if (!client) throw Error('appid和agentid对应的企业微信号信息不存在');

      let redirect_uri = ctx.query.redirect_uri;
      if (!redirect_uri) throw Error('缺失redirect_uri参数');

      if (ctx.query.code) {
        // 得到用户授权, 附加用户信息后重定向
        let token = await client.ensureAccessToken();
        let data = await client.request(`https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo?access_token=${token.accessToken}&code=${ctx.query.code}`);
        let userid_token = uuid.v1().replace(/-/g, '');
        if (ctx.redis) {
          ctx.redis.set(userid_token, JSON.stringify({
            appid: ctx.params.appid,
            agentid: ctx.params.agentid,
            userid: data.UserId
          }), err => {
            if (!err) ctx.redis.expire(userid_token, EXPIRE_SECONDS);
          });
        } else {
          userid_tokens.set(userid_token, { appid: ctx.params.appid, agentid: ctx.params.agentid, userid: data.UserId });
        }
        ctx.cookies.set('m:userid', userid_token, {
          httpOnly: true,
          overwrite: false,
          signed: true,
        });
        ctx.response.redirect(redirect_uri);
      } else {
        // 重定向到授权地址
        let url = client.getAuthorizeURL(ctx.href, 'm-scene');
        ctx.response.redirect(url);
      }
    });

    return async (ctx, next) => {
      ctx.wework = this;
      let userid_token = ctx.cookies.get('m:userid');
      if (userid_token != null) {
        if (ctx.redis) {
          const getAsync = promisify(ctx.redis.get).bind(ctx.redis);
          let value = await getAsync(userid_token);
          if (value) {
            let val = JSON.parse(value);
            ctx.appid = val.appid;
            ctx.agentid = val.agentid;
            ctx.userid = val.userid;
            ctx.redis.expire(userid_token, EXPIRE_SECONDS);
          }
        } else {
          let val = userid_tokens.get(userid_token);
          if (val) {
            ctx.appid = val.appid;
            ctx.agentid = val.agentid;
            ctx.userid = val.userid;
            userid_tokens.ttl(userid_token);
          }
        }
      }
      await router.routes()(ctx, next);
    };
  }
}

module.exports = Wework;