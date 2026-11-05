import { useQuery } from "@tanstack/react-query"
import { Alert, Button, Card, Checkbox, Descriptions, Space, Spin, Tag, Typography } from "antd"
import { useEffect, useRef, useState } from "react"
import { type IdentityApi, IdentityRequestError, identityApi } from "./api"
import { identityErrorText, statusLabels } from "./status"

export const IdentityVerificationPage = ({
  userId,
  onVerified,
  api = identityApi,
}: {
  readonly userId: string
  readonly onVerified: () => Promise<void>
  readonly api?: Pick<IdentityApi, "me" | "submit">
}) => {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState("")
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const key = useRef<string | null>(null)
  const state = useQuery({
    queryKey: ["identity", userId],
    queryFn: api.me,
    refetchInterval: (query) => (query.state.data?.status === "verifying" ? 2_000 : false),
  })
  const completedAttempt =
    state.data !== undefined &&
    ["verified", "rejected", "error", "unbound"].includes(state.data.status)
      ? `${state.data.status}:${state.data.currentAttemptId}`
      : null
  useEffect(() => {
    if (completedAttempt !== null) key.current = null
  }, [completedAttempt])
  useEffect(() => {
    if (file === null || typeof URL.createObjectURL !== "function") {
      setPreview("")
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const choose = (selected: File | undefined) => {
    key.current = null
    setError("")
    if (selected === undefined) {
      setFile(null)
      return
    }
    if (!["image/jpeg", "image/png"].includes(selected.type) || selected.size > 2_000_000) {
      setFile(null)
      setError("请选择不超过 2 MB 的 JPG 或 PNG 身份证人像面照片。")
      return
    }
    setFile(selected)
  }
  const submit = async () => {
    if (file === null || !consent || state.data === undefined || submitting) return
    setSubmitting(true)
    setError("")
    const requestKey = key.current ?? crypto.randomUUID()
    key.current = requestKey
    try {
      const attempt = await api.submit(file, state.data.consentVersion, requestKey)
      if (attempt.status !== "verifying") key.current = null
      await state.refetch()
      if (attempt.status === "verified") {
        setFile(null)
        await onVerified()
      } else if (attempt.errorCode !== null)
        setError(identityErrorText(new IdentityRequestError(attempt.errorCode)))
    } catch (failure) {
      setError(identityErrorText(failure))
      if (failure instanceof IdentityRequestError && failure.attemptId !== undefined)
        key.current = null
      await state.refetch()
    } finally {
      setSubmitting(false)
    }
  }
  if (state.isPending)
    return (
      <Spin description="正在读取认证状态…">
        <div style={{ minHeight: 160 }} />
      </Spin>
    )
  if (state.isError || state.data === undefined)
    return (
      <Alert
        type="error"
        title="无法读取认证状态"
        action={<Button onClick={() => void state.refetch()}>重试</Button>}
      />
    )
  const data = state.data
  const processing = submitting || data.status === "verifying"
  return (
    <Card title="管理员实名认证" style={{ maxWidth: 760, margin: "0 auto" }}>
      <Space orientation="vertical" size="large" style={{ width: "100%" }}>
        <Tag color={data.status === "verified" ? "success" : "processing"}>
          {statusLabels[data.status]}
        </Tag>
        {data.status === "verified" ? (
          <>
            <Descriptions
              column={1}
              items={[
                { key: "name", label: "姓名", children: data.maskedName },
                { key: "number", label: "身份证号", children: data.maskedNumber },
                {
                  key: "time",
                  label: "认证时间",
                  children:
                    data.verifiedAt === null
                      ? "—"
                      : new Date(data.verifiedAt).toLocaleString("zh-CN"),
                },
              ]}
            />
            <Typography.Paragraph type="secondary">
              需要更换实名信息时，请联系平台管理员解除绑定，然后重新认证。
            </Typography.Paragraph>
            <Button type="primary" onClick={() => void onVerified()}>
              进入系统
            </Button>
          </>
        ) : !data.canVerify ? (
          <Alert type="info" title="当前账号无需认证或认证功能尚未开放" />
        ) : (
          <>
            <Alert
              showIcon
              type="info"
              title="上传身份证人像面"
              description="系统将通过阿里云核验姓名与身份证号。此流程不包含人脸活体认证。请上传清晰、完整、无遮挡的照片。"
            />
            {!data.providerAvailable && (
              <Alert type="warning" title="认证服务尚未就绪，请联系平台管理员" />
            )}
            {processing && (
              <Alert
                showIcon
                type="info"
                title="正在核验，请勿重复提交"
                description="页面会自动更新状态；关闭页面不会撤回已经发出的核验。"
              />
            )}
            {error !== "" && <Alert showIcon type="error" title={error} />}
            {error === "" && data.lastErrorCode !== null && (
              <Alert
                type="warning"
                title={identityErrorText(new IdentityRequestError(data.lastErrorCode))}
              />
            )}
            <label htmlFor="identity-photo">身份证人像面</label>
            <input
              style={{ maxWidth: "100%" }}
              id="identity-photo"
              type="file"
              accept="image/jpeg,image/png"
              disabled={processing}
              onChange={(event) => choose(event.target.files?.[0])}
            />
            {preview !== "" && (
              <img
                alt="待提交的身份证人像面预览"
                src={preview}
                style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain" }}
              />
            )}
            <Typography.Paragraph type="secondary">
              支持 JPG、PNG，单张不超过 2
              MB。本系统不长期保存身份证原图；核验材料会传输给阿里云处理。系统保存必要的加密身份信息和认证记录。
            </Typography.Paragraph>
            <Checkbox
              checked={consent}
              disabled={processing}
              onChange={(event) => setConsent(event.target.checked)}
            >
              我已阅读上述说明，同意将本人身份证照片提供给阿里云进行身份信息核验，并将核验结果用于管理员实名认证。
            </Checkbox>
            <Button
              type="primary"
              loading={processing}
              disabled={file === null || !consent || !data.providerAvailable || processing}
              onClick={() => void submit()}
            >
              提交认证
            </Button>
          </>
        )}
      </Space>
    </Card>
  )
}
