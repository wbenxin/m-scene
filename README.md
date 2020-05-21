# m-scene
基于koa2中间件的公众号/企业号/小程序等移动场景的服务封装

## 公众号

导出了Wechat类型, 接收config参数, 支持同时为多个公众号提供服务

在koa中这样引入:

```
const { Wechat } = require('m-scene');

const wechat = new Wechat(config);
<koa_app>.use(wechat.middleware());
```

其中config配置对象的格式为:
```
{
  'name': {
    'appid': 'string',
    'secret': 'string',
    'token': 'string',
    'encodingAESKey': 'string',
    'handler': function(msg) {},
  }
}
```

在koa中引入此中间件后, 会在ctx对象中增加```wechat```属性(Wechat的实例)和```openid```属性

```
<koa_app>.use(async (ctx, next)=>{
  let api = ctx.wechat.api(appid);
  // 获取微信服务器的IP地址
  let res = await api.getIp();
  ctx.body = res;
});
```

> 受支持的全部api函数列表及参数说明, 请参考```co-wechat-api```源代码, 或者移步: https://doxmate.cool/node-webot/co-wechat-api/api.html

## 企业微信号

导出了Wework类型, 接收config参数, 支持同时为多个企业微信号提供服务

在koa中这样引入:

```
const { Wework } = require('m-scene');

const wework = new Wework(config);
<koa_app>.use(wework.middleware());
```

其中config配置对象的格式为:
```
{
  'name': {
    'appid': 'string',
    'agents': [{
      'agentid': 'string',
      'name': 'string',
      'secret': 'string',
      'token': 'string',
      'encodingAESKey': 'string',
      'handler': function(msg) {},
    }]
  }
}
```

在koa中引入此中间件后, 会在ctx对象中增加```wework```属性(Wework的实例)和```userid```属性

```
<koa_app>.use(async (ctx, next)=>{
  let api = ctx.wework.api(appid, agentid);
  // 获取agent列表
  let res = await api.listAgent();
  ctx.body = res;
});
```

> 受支持的全部api函数列表及参数说明, 请参考```co-wechat-enterprise-api```源代码, 或者移步: https://doxmate.cool/node-webot/wechat-enterprise-api/api.html
