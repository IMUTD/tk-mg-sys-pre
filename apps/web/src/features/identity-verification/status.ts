import { IdentityRequestError } from "./api"

export const statusLabels: Readonly<Record<string, string>> = {
  unverified: "未认证",
  verifying: "认证中",
  verified: "已认证",
  rejected: "认证未通过",
  error: "核验异常",
  unbound: "已解绑",
  not_required: "无需认证",
  superseded: "已作废",
}
const errors: Readonly<Record<string, string>> = {
  identity_already_bound: "该身份证已绑定其他账号，请联系平台处理。",
  stale_version: "认证状态已变化，请刷新后再操作。",
  identity_provider_unavailable: "认证服务暂不可用，请稍后重试或联系平台。",
  identity_provider_timeout: "核验超时，正在查询本地结果，请勿重复提交。",
  rate_limited: "提交过于频繁或已达到今日限额，请稍后重试。",
  consent_required: "请先阅读并同意身份信息核验授权。",
  image_too_large: "图片不能超过 2 MB。",
  unsupported_image: "请上传 JPG 或 PNG 身份证人像面照片。",
  invalid_image: "图片无法识别，请上传清晰完整的身份证人像面。",
  identity_image_unusable: "图片无法识别，请上传清晰完整的身份证人像面。",
  identity_ocr_failed: "未能读取身份证信息，请重新拍摄清晰照片。",
  identity_mismatch: "姓名与身份证号不一致，请检查照片后重新提交。",
  invalid_operator_password: "操作密码不正确。",
  invalid_password: "操作密码不正确。",
  already_verified: "当前账号已认证，请刷新查看。",
}
export const identityErrorText = (error: unknown): string =>
  error instanceof IdentityRequestError
    ? (errors[error.code] ?? "操作未完成，请刷新状态后重试或联系平台。")
    : "网络请求未完成，请刷新状态后再试。"
