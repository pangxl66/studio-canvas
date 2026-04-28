import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };

type State = { error: Error | null; componentStack: string };

/**
 * 捕获画布子树渲染错误，避免整页白屏（如节点数据异常导致某组件 throw）。
 */
export class StudioErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack || '' });
    console.error('StudioErrorBoundary', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="studio-error-boundary" role="alert">
          <h1 className="studio-error-boundary__title">画布渲染出错</h1>
          <p className="studio-error-boundary__msg">
            {this.state.error.message || '未知错误'}
          </p>
          <p className="studio-error-boundary__hint">
            可尝试刷新页面。若刚完成 AI 任务，可能与节点数据短暂不一致有关；如反复出现请通过「项目管理 → 打开项目」恢复备份。
          </p>
          {this.state.componentStack ? (
            <pre className="studio-error-boundary__msg">{this.state.componentStack.trim()}</pre>
          ) : null}
          <button
            type="button"
            className="studio-error-boundary__btn"
            onClick={() => window.location.reload()}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
