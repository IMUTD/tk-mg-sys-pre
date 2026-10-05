import { Button, Result } from "antd"
import { Component, type ErrorInfo, type ReactNode } from "react"

type QueryErrorBoundaryProps = { readonly children: ReactNode }
type QueryErrorBoundaryState = { readonly error: Error | null }

class UnhandledQueryError extends Error {
  readonly name = "UnhandledQueryError"

  constructor() {
    super("The page data could not be loaded")
  }
}

export class QueryErrorBoundary extends Component<
  QueryErrorBoundaryProps,
  QueryErrorBoundaryState
> {
  state: QueryErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): QueryErrorBoundaryState {
    return { error: error instanceof Error ? error : new UnhandledQueryError() }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    void error
    void errorInfo
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <section className="page-message" role="alert">
          <Result
            extra={
              <Button onClick={() => this.setState({ error: null })} type="default">
                重试
              </Button>
            }
            status="error"
            subTitle="请检查 API 服务和内网连接后重试。"
            title="页面数据暂时无法加载"
          />
        </section>
      )
    }
    return this.props.children
  }
}
