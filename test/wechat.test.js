const { Wechat } = require('../index');
const Koa = require('koa');
const assert = require("assert");
const request = require('supertest');

before(() => {
  this.app = new Koa();
  this.app.keys = ['ZN2ouUeVyedPR14EEV4eifuU8vA40Kzh', 'DreWsXA7IKH7LkrYZ7gSRJL8xiUUvQFF'];
  this.app.use(new Wechat({
    "测试公众号": {
      appid: 'wxf77e28224ff81cdd',
      secret: 'a14e0eddd7c9a67415f0633f5d9cb57e',
      token: '7174CCDB7FC8464DB517DCC6B7B866A3',
      encodingAESKey: 'JtqR4ttZQrzzMw7I6q87Qvw86W8Rur8a5vfWItqTQT8',
      handler: async (message, ctx) => {
        console.log(JSON.stringify(message));
        return `Your OPENID Is ${message.FromUserName}`;
      },
    }
  }).middleware());
});

describe('Wechat', () => {
  describe('use in koa2', () => {
    it('/wechat/event/wxf77e28224ff81cdd', () => {
      this.app.use(async (ctx, next) => {
        assert(ctx.wechat);
        assert(ctx.wechat.oauth);
        assert(ctx.wechat.api);
      });

      request(this.app.listen())
        .get('/wechat/event/wxf77e28224ff81cdd')
        .expect(401);
    });
  });
});
