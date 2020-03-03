# m-scene
基于koa2中间件的公众号/企业号/小程序等移动场景的服务封装

## 公众号

导出了Wechat类型, 接收config参数, 支持同时为多个公众号提供服务

```
const { Wechat } = require('wechat');
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
    'handler': 'function(msg) {}',
  }
}
```

会在ctx对象中增加wechat属性(Wechat的实例)

```
<koa_app>.use(async (ctx, next)=>{
  let wechat_api = ctx.wechat.api;
  // 获取微信服务器的IP地址
  let res = await wechat_api.getIp();
  ctx.body = res;
});
```