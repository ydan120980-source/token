# 本地加密实验协议

仅使用合成 UsageSnapshotV1。发送、接收各为独立 Node 进程；不连接真实统计、云资源或手机。

外层 JSON 格式：

```json
{
  "header": {"protocol":"M1-CRYPTO-EXPERIMENT/1","deviceId":"synthetic-vector-device","sequence":2},
  "nonce":"base64 of 12 random bytes",
  "ciphertext":"base64 of encrypted UTF-8 snapshot JSON",
  "tag":"base64 of 16-byte authentication tag"
}
```

AES-256-GCM，随机 32-byte 密钥，每次随机 96-bit nonce，128-bit tag。AAD 是 `JSON.stringify(header)` 的 UTF-8 字节；字段顺序严格为 protocol、deviceId、sequence，移动端应显式构造该顺序，不能任意重排 AAD。

接收端固定 deviceId，并维护最高有效 sequence；认证与内层 schema/device/sequence 一致性检查通过后才推进。错误密钥、密文/头部篡改、重复和旧序号均拒绝。实验 highest 在进程内；生产端还必须持久化防回放状态。

运行 `npm.cmd run experiment:crypto` 生成本次密文向量与已知合成明文到忽略的 `artifacts/crypto-vector.json`。密钥只经测试子进程 stdin 管道传递，不写文件或日志，因此交付的无密钥密文用于格式检查；需要解密测试时重新运行生成器。在后续 iPhone 互操作阶段，通过获准的本地测试渠道交付当次密钥，不能把当前文件宣称为完整跨平台可解密向量。

通过项：正确解密、错误密钥、密文篡改、头部篡改、旧快照、重复投递。未实施项：配对、密钥保存/分发/恢复/撤销、生产 nonce 管理、持久化回放、iPhone 真机互操作。不是完整 E2EE 产品验收。
