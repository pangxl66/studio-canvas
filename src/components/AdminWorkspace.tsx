import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowClockwise,
  ArrowLeft,
  ChartBar,
  CheckCircle,
  Clock,
  Coins,
  Database,
  FolderOpen,
  Gauge,
  HardDrives,
  Heartbeat,
  ImageSquare,
  MagnifyingGlass,
  Pulse,
  Queue,
  Robot,
  ShieldCheck,
  SlidersHorizontal,
  UserCircle,
  UsersThree,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import {
  fetchAdminCreditDetails,
  updateAdminCredits,
  type AdminCreditDetails,
  type AdminUserRecord,
} from '@/services/adminCreditService';
import {
  loadAdminProjectVersions,
  loadAdminWorkspaceData,
  type AdminProjectRecord,
  type AdminTaskState,
  type AdminWorkspaceData,
  type AdminWorkspaceTask,
} from '@/services/adminWorkspaceService';
import type { DiskProjectVersionSummary } from '@/services/localProjectDiskService';

interface AdminWorkspaceProps {
  onChanged?: () => void;
  onClose: () => void;
}

type AdminSection = 'jobs' | 'overview' | 'projects' | 'system' | 'usage' | 'users';

const sectionItems = [
  { id: 'overview' as const, label: '运营总览', icon: Gauge },
  { id: 'users' as const, label: '用户与权限', icon: UsersThree },
  { id: 'jobs' as const, label: '任务与生成', icon: Queue },
  { id: 'projects' as const, label: '工程与存储', icon: FolderOpen },
  { id: 'usage' as const, label: '用量与额度', icon: ChartBar },
  { id: 'system' as const, label: '系统与审计', icon: Pulse },
];

const taskStateLabels: Record<AdminTaskState, string> = {
  attention: '需要处理',
  failed: '失败',
  queued: '待执行',
  running: '运行中',
  success: '已完成',
};

const nodeTypeLabels: Record<string, string> = {
  aiFilmStoryboard: '九宫格分镜',
  department: '部门节点',
  imageNode: '图片生成',
  promptReview: '提示词',
  shotList: '分镜表',
  textNode: '文本节点',
  videoNode: '视频节点',
};

function formatDate(value: string | number | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
  });
}

function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const days = Math.floor(value / 86_400);
  const hours = Math.floor((value % 86_400) / 3_600);
  if (days) return `${days} 天 ${hours} 小时`;
  const minutes = Math.floor(value / 60);
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function modelLabel(model: string): string {
  if (model === 'gemini-3.1-flash-image') return 'Nano Banana 2';
  return model || '默认模型';
}

function userStatusLabel(user: AdminUserRecord): string {
  if (user.status === 'banned') return '已停用';
  if (user.status === 'pending') return '待验证';
  return '正常';
}

function usageStatusLabel(status: string): string {
  if (status === 'success') return '成功';
  if (status === 'failed') return '失败';
  return status || '未知';
}

function emptyData(): AdminWorkspaceData {
  return {
    activeProjectId: '',
    activeProjectName: '',
    errors: [],
    health: {
      authMode: 'unknown',
      checks: {},
      ok: false,
      providers: [],
      serverUptimeSec: 0,
      timestamp: new Date().toISOString(),
    },
    projects: [],
    tasks: [],
    usageEvents: [],
    users: [],
  };
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'attention' | 'danger' | 'info' | 'neutral' | 'success';
}) {
  return <span className={`admin-workspace__status admin-workspace__status--${tone}`}>{label}</span>;
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="admin-workspace__section-title">
      <p>{eyebrow}</p>
      <h2>{title}</h2>
      <span>{description}</span>
    </div>
  );
}

function OverviewPanel({
  data,
  onNavigate,
}: {
  data: AdminWorkspaceData;
  onNavigate: (section: AdminSection) => void;
}) {
  const failedTasks = data.tasks.filter((task) => task.state === 'failed');
  const attentionTasks = data.tasks.filter((task) => task.state === 'attention');
  const runningTasks = data.tasks.filter((task) => task.state === 'running');
  const successCalls = data.usageEvents.filter((event) => event.status === 'success').length;
  const successRate = data.usageEvents.length
    ? Math.round((successCalls / data.usageEvents.length) * 100)
    : 100;
  const quotaCost = data.usageEvents.reduce((total, event) => total + Number(event.quotaCost || 0), 0);
  const projectRisk = data.projects.filter(
    (project) => Date.now() - project.updatedAt > 1000 * 60 * 60 * 24 * 7,
  ).length;
  const alerts = [...failedTasks, ...attentionTasks].slice(0, 5);

  return (
    <>
      <div className="admin-workspace__hero">
        <div>
          <div className="admin-workspace__hero-status">
            <StatusBadge
              label={data.health.ok ? '所有核心服务正常' : '系统存在异常'}
              tone={data.health.ok ? 'success' : 'danger'}
            />
            <span>最近检查 {formatDate(data.health.timestamp)}</span>
          </div>
          <h1>Studio 运营总览</h1>
          <p>从这里观察生成任务、工程保存和模型服务，优先处理真正影响创作流程的问题。</p>
        </div>
        <div className="admin-workspace__hero-orbit" aria-hidden="true">
          <Pulse size={34} weight="duotone" />
        </div>
      </div>

      <div className="admin-workspace__metrics">
        <article className="admin-workspace__metric-card">
          <span>已登记用户</span>
          <strong>{data.users.length}</strong>
          <small>本地测试与正式账号</small>
          <UsersThree size={20} weight="duotone" />
        </article>
        <article className="admin-workspace__metric-card">
          <span>工程总数</span>
          <strong>{data.projects.length}</strong>
          <small>{projectRisk ? `${projectRisk} 个工程超过 7 天未更新` : '工程保存状态正常'}</small>
          <FolderOpen size={20} weight="duotone" />
        </article>
        <article className="admin-workspace__metric-card">
          <span>运行与待处理</span>
          <strong>{runningTasks.length + attentionTasks.length}</strong>
          <small>{failedTasks.length ? `${failedTasks.length} 个任务失败` : '没有失败任务'}</small>
          <Queue size={20} weight="duotone" />
        </article>
        <article className="admin-workspace__metric-card">
          <span>近期生成成功率</span>
          <strong>{successRate}%</strong>
          <small>{data.usageEvents.length} 次调用 · 消耗 {quotaCost} 点</small>
          <Heartbeat size={20} weight="duotone" />
        </article>
      </div>

      {(alerts.length > 0 || data.errors.length > 0) && (
        <button className="admin-workspace__alert" type="button" onClick={() => onNavigate('jobs')}>
          <span className="admin-workspace__alert-icon">
            <WarningCircle size={22} weight="fill" />
          </span>
          <span>
            <strong>{failedTasks.length + attentionTasks.length + data.errors.length} 项需要关注</strong>
            <small>
              {failedTasks.length
                ? '检测到失败节点，建议先查看任务详情。'
                : '发现旧审核状态或数据源读取异常。'}
            </small>
          </span>
          <span className="admin-workspace__alert-action">查看待处理任务</span>
        </button>
      )}

      <div className="admin-workspace__overview-grid">
        <section className="admin-workspace__panel">
          <div className="admin-workspace__panel-heading">
            <div>
              <span>任务态势</span>
              <h3>当前工程节点</h3>
            </div>
            <button type="button" onClick={() => onNavigate('jobs')}>查看全部</button>
          </div>
          <div className="admin-workspace__task-summary">
            {(['success', 'running', 'attention', 'failed', 'queued'] as AdminTaskState[]).map((state) => {
              const count = data.tasks.filter((task) => task.state === state).length;
              const percent = data.tasks.length ? Math.round((count / data.tasks.length) * 100) : 0;
              return (
                <div className="admin-workspace__task-summary-row" key={state}>
                  <span>{taskStateLabels[state]}</span>
                  <div><i className={`is-${state}`} style={{ width: `${percent}%` }} /></div>
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>
          <div className="admin-workspace__active-project">
            <span>当前工程</span>
            <strong>{data.activeProjectName || '尚未打开工程'}</strong>
            <small>{data.tasks.length} 个工作节点</small>
          </div>
        </section>

        <section className="admin-workspace__panel">
          <div className="admin-workspace__panel-heading">
            <div>
              <span>服务状态</span>
              <h3>模型与基础设施</h3>
            </div>
            <button type="button" onClick={() => onNavigate('system')}>系统详情</button>
          </div>
          <div className="admin-workspace__service-list">
            {data.health.providers.slice(0, 3).map((provider) => {
              const healthy =
                provider.apiKey
                && provider.upstream
                && !provider.failureState?.coolingDown;
              return (
                <div key={provider.provider}>
                  <span className={`admin-workspace__service-dot ${healthy ? 'is-online' : 'is-offline'}`} />
                  <span>
                    <strong>{provider.provider === 'default' ? '主语言模型' : provider.provider}</strong>
                    <small>{provider.primaryModel}</small>
                  </span>
                  <StatusBadge label={healthy ? '正常' : '异常'} tone={healthy ? 'success' : 'danger'} />
                </div>
              );
            })}
            <div>
              <span className="admin-workspace__service-dot is-online" />
              <span>
                <strong>图片生成</strong>
                <small>Nano Banana 2 · image2</small>
              </span>
              <StatusBadge label="已接入" tone="info" />
            </div>
            <div>
              <span className={`admin-workspace__service-dot ${data.projects.length ? 'is-online' : 'is-attention'}`} />
              <span>
                <strong>本地工程库</strong>
                <small>{data.projects.length} 个工程可读取</small>
              </span>
              <StatusBadge label={data.projects.length ? '正常' : '待确认'} tone={data.projects.length ? 'success' : 'attention'} />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function UsersPanel({
  data,
  onSelectUser,
}: {
  data: AdminWorkspaceData;
  onSelectUser: (user: AdminUserRecord) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const users = useMemo(() => data.users.filter((user) => {
    const matchesQuery =
      !query.trim()
      || user.email.toLowerCase().includes(query.trim().toLowerCase())
      || (user.displayName || '').toLowerCase().includes(query.trim().toLowerCase());
    const matchesStatus = status === 'all' || user.status === status;
    return matchesQuery && matchesStatus;
  }), [data.users, query, status]);

  return (
    <>
      <SectionTitle
        eyebrow="ACCOUNTS"
        title="用户与权限"
        description="查看账号活跃度、工程和额度；额度操作改为显式详情抽屉，不再依赖右键。"
      />
      <div className="admin-workspace__toolbar">
        <label className="admin-workspace__search">
          <MagnifyingGlass size={18} />
          <input
            aria-label="搜索用户"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索邮箱或名称"
            value={query}
          />
        </label>
        <label className="admin-workspace__select">
          <SlidersHorizontal size={18} />
          <select aria-label="筛选用户状态" onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="all">全部状态</option>
            <option value="active">正常</option>
            <option value="pending">待验证</option>
            <option value="banned">已停用</option>
          </select>
        </label>
        <span className="admin-workspace__toolbar-count">共 {users.length} 位用户</span>
      </div>
      <div className="admin-workspace__table-shell">
        <table className="admin-workspace__table">
          <thead>
            <tr>
              <th>用户</th>
              <th>状态</th>
              <th>额度</th>
              <th>工程</th>
              <th>调用</th>
              <th>失败</th>
              <th>最近使用</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={`${user.source}-${user.userId}`}>
                <td>
                  <span className="admin-workspace__user-cell">
                    <span><UserCircle size={24} weight="duotone" /></span>
                    <span>
                      <strong>{user.displayName || '未命名用户'}</strong>
                      <small>{user.email}</small>
                    </span>
                  </span>
                </td>
                <td>
                  <StatusBadge
                    label={userStatusLabel(user)}
                    tone={user.status === 'banned' ? 'danger' : user.status === 'pending' ? 'attention' : 'success'}
                  />
                </td>
                <td><strong className="admin-workspace__quota-value">{user.remainingQuota}</strong> / {user.monthlyQuota}</td>
                <td>{user.projectCount}</td>
                <td>{user.totalUsage}</td>
                <td>{user.failedUsage}</td>
                <td>{formatDate(user.lastUsageAt || user.lastSignInAt)}</td>
                <td>
                  <button className="admin-workspace__row-action" type="button" onClick={() => onSelectUser(user)}>
                    管理额度
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length && (
          <div className="admin-workspace__empty">
            <UsersThree size={30} weight="duotone" />
            <strong>没有匹配的用户</strong>
            <span>调整搜索词或状态筛选后再试。</span>
          </div>
        )}
      </div>
    </>
  );
}

function JobsPanel({
  data,
  onSelectTask,
}: {
  data: AdminWorkspaceData;
  onSelectTask: (task: AdminWorkspaceTask) => void;
}) {
  const [state, setState] = useState<'all' | AdminTaskState>('all');
  const [query, setQuery] = useState('');
  const tasks = useMemo(() => data.tasks
    .filter((task) => state === 'all' || task.state === state)
    .filter((task) =>
      !query.trim()
      || `${task.label} ${task.nodeType} ${task.model}`.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => {
      const order: Record<AdminTaskState, number> = {
        failed: 0,
        attention: 1,
        running: 2,
        queued: 3,
        success: 4,
      };
      return order[a.state] - order[b.state];
    }), [data.tasks, query, state]);

  return (
    <>
      <SectionTitle
        eyebrow="GENERATIONS"
        title="任务与生成"
        description="统一查看当前工程中的文本、分镜、九宫格和图片任务，优先暴露失败与遗留审核状态。"
      />
      <div className="admin-workspace__toolbar">
        <label className="admin-workspace__search">
          <MagnifyingGlass size={18} />
          <input
            aria-label="搜索任务"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索节点、模型或任务"
            value={query}
          />
        </label>
        <label className="admin-workspace__select">
          <SlidersHorizontal size={18} />
          <select aria-label="筛选任务状态" onChange={(event) => setState(event.target.value as 'all' | AdminTaskState)} value={state}>
            <option value="all">全部任务</option>
            <option value="failed">失败</option>
            <option value="attention">需要处理</option>
            <option value="running">运行中</option>
            <option value="queued">待执行</option>
            <option value="success">已完成</option>
          </select>
        </label>
        <span className="admin-workspace__toolbar-count">{data.activeProjectName || '未打开工程'} · {tasks.length} 项</span>
      </div>
      <div className="admin-workspace__table-shell">
        <table className="admin-workspace__table">
          <thead>
            <tr>
              <th>任务</th>
              <th>类型</th>
              <th>状态</th>
              <th>模型</th>
              <th>工程</th>
              <th>最近保存</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <strong>{task.label}</strong>
                  <small className="admin-workspace__table-subtitle">{task.id}</small>
                </td>
                <td>{nodeTypeLabels[task.nodeType] || task.nodeType || '工作节点'}</td>
                <td>
                  <StatusBadge
                    label={taskStateLabels[task.state]}
                    tone={
                      task.state === 'failed'
                        ? 'danger'
                        : task.state === 'attention'
                          ? 'attention'
                          : task.state === 'success'
                            ? 'success'
                            : task.state === 'running'
                              ? 'info'
                              : 'neutral'
                    }
                  />
                </td>
                <td>{modelLabel(task.model)}</td>
                <td>{task.projectName}</td>
                <td>{formatDate(task.updatedAt)}</td>
                <td>
                  <button className="admin-workspace__row-action" type="button" onClick={() => onSelectTask(task)}>
                    查看详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!tasks.length && (
          <div className="admin-workspace__empty">
            <Queue size={30} weight="duotone" />
            <strong>当前筛选没有任务</strong>
            <span>切换任务状态或打开一个工程后再查看。</span>
          </div>
        )}
      </div>
    </>
  );
}

function ProjectsPanel({
  data,
  onSelectProject,
}: {
  data: AdminWorkspaceData;
  onSelectProject: (project: AdminProjectRecord) => void;
}) {
  return (
    <>
      <SectionTitle
        eyebrow="PROJECT LIBRARY"
        title="工程与存储"
        description="监控工程保存、自动恢复和版本历史，尽早发现长期未更新或只有自动保存的工程。"
      />
      <div className="admin-workspace__project-grid">
        {data.projects.map((project) => {
          const isStale = Date.now() - project.updatedAt > 1000 * 60 * 60 * 24 * 7;
          return (
            <button className="admin-workspace__project-card" key={project.projectId} type="button" onClick={() => onSelectProject(project)}>
              <span className="admin-workspace__project-icon"><FolderOpen size={24} weight="duotone" /></span>
              <span className="admin-workspace__project-main">
                <span>
                  <strong>{project.projectName}</strong>
                  {project.isAutosave ? <StatusBadge label="自动保存" tone="info" /> : null}
                </span>
                <small>{project.projectId}</small>
                <span className="admin-workspace__project-meta">
                  <span>{project.nodeCount} 节点</span>
                  <span>{project.edgeCount} 条连线</span>
                  <span>保存于 {formatDate(project.updatedAt)}</span>
                </span>
              </span>
              <StatusBadge label={isStale ? '需要确认' : '保存正常'} tone={isStale ? 'attention' : 'success'} />
            </button>
          );
        })}
        {!data.projects.length && (
          <div className="admin-workspace__empty admin-workspace__empty--wide">
            <HardDrives size={32} weight="duotone" />
            <strong>尚未发现本地工程</strong>
            <span>创建或保存工程后，这里会展示保存与版本状态。</span>
          </div>
        )}
      </div>
    </>
  );
}

function UsagePanel({ data }: { data: AdminWorkspaceData }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const events = useMemo(() => data.usageEvents.filter((event) => {
    const searchable = `${event.user.email} ${event.feature} ${event.model}`.toLowerCase();
    return (
      (!query.trim() || searchable.includes(query.trim().toLowerCase()))
      && (status === 'all' || event.status === status)
    );
  }), [data.usageEvents, query, status]);
  const totalCost = events.reduce((total, event) => total + Number(event.quotaCost || 0), 0);
  const failed = events.filter((event) => event.status === 'failed').length;
  const models = new Set(events.map((event) => event.model).filter(Boolean)).size;

  return (
    <>
      <SectionTitle
        eyebrow="USAGE & CREDITS"
        title="用量与额度"
        description="从原始调用记录中快速定位失败功能、模型消耗和用户使用情况。"
      />
      <div className="admin-workspace__mini-metrics">
        <div><span>当前记录</span><strong>{events.length}</strong></div>
        <div><span>额度消耗</span><strong>{totalCost}</strong></div>
        <div><span>失败调用</span><strong>{failed}</strong></div>
        <div><span>涉及模型</span><strong>{models}</strong></div>
      </div>
      <div className="admin-workspace__toolbar">
        <label className="admin-workspace__search">
          <MagnifyingGlass size={18} />
          <input
            aria-label="搜索使用记录"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索邮箱、功能或模型"
            value={query}
          />
        </label>
        <label className="admin-workspace__select">
          <SlidersHorizontal size={18} />
          <select aria-label="筛选调用状态" onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="all">全部状态</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
          </select>
        </label>
      </div>
      <div className="admin-workspace__table-shell">
        <table className="admin-workspace__table">
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>功能</th>
              <th>模型</th>
              <th>状态</th>
              <th>消耗</th>
              <th>输入 / 输出</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => (
              <tr key={`${event.createdAt}-${index}`}>
                <td>{formatDate(event.createdAt)}</td>
                <td>{event.user.email || '—'}</td>
                <td>{event.feature || '—'}</td>
                <td>{modelLabel(event.model)}</td>
                <td>
                  <StatusBadge
                    label={usageStatusLabel(event.status)}
                    tone={event.status === 'failed' ? 'danger' : event.status === 'success' ? 'success' : 'neutral'}
                  />
                </td>
                <td>{event.quotaCost}</td>
                <td>{event.inputChars} / {event.outputChars}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length && (
          <div className="admin-workspace__empty">
            <ChartBar size={30} weight="duotone" />
            <strong>没有匹配的使用记录</strong>
            <span>生成任务完成后，调用记录会自动出现在这里。</span>
          </div>
        )}
      </div>
    </>
  );
}

function SystemPanel({ data }: { data: AdminWorkspaceData }) {
  const checks = Object.entries(data.health.checks);
  return (
    <>
      <SectionTitle
        eyebrow="SYSTEM CONTROL"
        title="系统与审计"
        description="查看认证、语言模型、图片模型和本地工程库状态，为后续告警与管理员审计预留入口。"
      />
      <div className="admin-workspace__system-grid">
        <section className="admin-workspace__panel">
          <div className="admin-workspace__panel-heading">
            <div><span>基础设施</span><h3>核心健康检查</h3></div>
            <StatusBadge label={data.health.ok ? '健康' : '异常'} tone={data.health.ok ? 'success' : 'danger'} />
          </div>
          <div className="admin-workspace__health-list">
            {checks.map(([key, healthy]) => (
              <div key={key}>
                {healthy
                  ? <CheckCircle size={21} weight="fill" />
                  : <WarningCircle size={21} weight="fill" />}
                <span>
                  <strong>{key === 'llmApiKey' ? '模型密钥' : key === 'llmUpstream' ? '模型上游' : key === 'authBackend' ? '认证服务' : key}</strong>
                  <small>{healthy ? '检查通过' : '需要检查配置'}</small>
                </span>
                <StatusBadge label={healthy ? '正常' : '异常'} tone={healthy ? 'success' : 'danger'} />
              </div>
            ))}
            <div>
              <Database size={21} weight="duotone" />
              <span>
                <strong>认证模式</strong>
                <small>{data.health.authMode === 'test-invite' ? '本地邀请账号' : data.health.authMode}</small>
              </span>
              <StatusBadge label="已连接" tone="info" />
            </div>
            <div>
              <Clock size={21} weight="duotone" />
              <span>
                <strong>服务运行时间</strong>
                <small>{formatDuration(data.health.serverUptimeSec)}</small>
              </span>
              <StatusBadge label="运行中" tone="success" />
            </div>
          </div>
        </section>

        <section className="admin-workspace__panel">
          <div className="admin-workspace__panel-heading">
            <div><span>模型路由</span><h3>语言与图片模型</h3></div>
            <Robot size={22} weight="duotone" />
          </div>
          <div className="admin-workspace__model-list">
            {data.health.providers.map((provider) => (
              <div key={provider.provider}>
                <span className="admin-workspace__model-icon"><Robot size={20} weight="duotone" /></span>
                <span>
                  <strong>{provider.primaryModel}</strong>
                  <small>{provider.provider} · {provider.fallbackModels?.length ? `备用 ${provider.fallbackModels.join(', ')}` : '无备用模型'}</small>
                </span>
                <StatusBadge
                  label={provider.failureState?.coolingDown ? '冷却中' : '可用'}
                  tone={provider.failureState?.coolingDown ? 'attention' : 'success'}
                />
              </div>
            ))}
            {['Nano Banana 2', 'image2'].map((model) => (
              <div key={model}>
                <span className="admin-workspace__model-icon"><ImageSquare size={20} weight="duotone" /></span>
                <span><strong>{model}</strong><small>图片生成 · 已配置到节点模型列表</small></span>
                <StatusBadge label="已接入" tone="info" />
              </div>
            ))}
          </div>
        </section>
      </div>

      {data.errors.length > 0 && (
        <section className="admin-workspace__panel admin-workspace__diagnostics">
          <div className="admin-workspace__panel-heading">
            <div><span>诊断信息</span><h3>数据读取提醒</h3></div>
            <WarningCircle size={22} weight="duotone" />
          </div>
          {data.errors.map((error) => <p key={error}>{error}</p>)}
        </section>
      )}
    </>
  );
}

function UserDrawer({
  user,
  onChanged,
  onClose,
}: {
  onChanged: () => void;
  onClose: () => void;
  user: AdminUserRecord;
}) {
  const [details, setDetails] = useState<AdminCreditDetails | null>(null);
  const [amount, setAmount] = useState('10');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setIsBusy(true);
    void fetchAdminCreditDetails(user.email)
      .then((result) => {
        if (active) setDetails(result);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : '额度读取失败。');
      })
      .finally(() => {
        if (active) setIsBusy(false);
      });
    return () => {
      active = false;
    };
  }, [user.email]);

  const runAction = async (action: 'add' | 'reset' | 'set') => {
    if (!reason.trim()) {
      setMessage('请先填写调整原因，便于后续审计。');
      return;
    }
    const numericAmount = Number.parseInt(amount, 10);
    if (action !== 'reset' && (!Number.isFinite(numericAmount) || numericAmount < 0)) {
      setMessage('请输入有效的额度数值。');
      return;
    }
    setIsBusy(true);
    setMessage('');
    try {
      const result = await updateAdminCredits(user.email, action, numericAmount, reason.trim());
      setDetails(result);
      setMessage('额度已更新。');
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '额度更新失败。');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <aside className="admin-workspace__drawer" aria-label="用户额度详情">
      <header>
        <div>
          <p>USER DETAIL</p>
          <h2>{user.displayName || '未命名用户'}</h2>
          <span>{user.email}</span>
        </div>
        <button type="button" aria-label="关闭用户详情" onClick={onClose}><X size={20} /></button>
      </header>
      <div className="admin-workspace__drawer-body">
        <div className="admin-workspace__drawer-balance">
          <span><Coins size={21} weight="duotone" /> 当前额度</span>
          <strong>
            {details?.wallet.remainingQuota ?? user.remainingQuota}
            <small> / {details?.wallet.monthlyQuota ?? user.monthlyQuota}</small>
          </strong>
          <small>最近更新 {formatDate(details?.wallet.updatedAt || user.walletUpdatedAt)}</small>
        </div>
        <div className="admin-workspace__drawer-stats">
          <div><span>调用</span><strong>{user.totalUsage}</strong></div>
          <div><span>失败</span><strong>{user.failedUsage}</strong></div>
          <div><span>工程</span><strong>{user.projectCount}</strong></div>
        </div>
        <label className="admin-workspace__field">
          调整数值
          <input disabled={isBusy} min={0} type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="admin-workspace__field">
          调整原因
          <textarea
            disabled={isBusy}
            placeholder="例如：测试额度补发、失败任务返还"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="admin-workspace__drawer-actions">
          <button disabled={isBusy} type="button" onClick={() => void runAction('add')}>增加额度</button>
          <button disabled={isBusy} type="button" onClick={() => void runAction('set')}>设为指定值</button>
          <button disabled={isBusy} type="button" onClick={() => void runAction('reset')}>重置月额度</button>
        </div>
        {message ? <p className="admin-workspace__drawer-message">{message}</p> : null}
      </div>
    </aside>
  );
}

function TaskDrawer({ task, onClose }: { onClose: () => void; task: AdminWorkspaceTask }) {
  return (
    <aside className="admin-workspace__drawer" aria-label="任务详情">
      <header>
        <div>
          <p>GENERATION DETAIL</p>
          <h2>{task.label}</h2>
          <span>{task.id}</span>
        </div>
        <button type="button" aria-label="关闭任务详情" onClick={onClose}><X size={20} /></button>
      </header>
      <div className="admin-workspace__drawer-body">
        <div className="admin-workspace__detail-list">
          <div><span>状态</span><strong>{taskStateLabels[task.state]}</strong></div>
          <div><span>节点类型</span><strong>{nodeTypeLabels[task.nodeType] || task.nodeType}</strong></div>
          <div><span>模型</span><strong>{modelLabel(task.model)}</strong></div>
          <div><span>工程</span><strong>{task.projectName}</strong></div>
          <div><span>原始状态</span><strong>{task.rawStatus}</strong></div>
          <div><span>最近保存</span><strong>{formatDate(task.updatedAt)}</strong></div>
        </div>
        {task.state === 'attention' && (
          <div className="admin-workspace__drawer-note">
            <WarningCircle size={20} weight="duotone" />
            <span>
              <strong>发现旧审核状态</strong>
              <small>该节点仍保留 WAITING_REVIEW。建议回到画布重新运行或完成遗留状态迁移。</small>
            </span>
          </div>
        )}
        {task.error && (
          <div className="admin-workspace__drawer-error">
            <strong>最近错误</strong>
            <p>{task.error}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function ProjectDrawer({
  project,
  onClose,
}: {
  onClose: () => void;
  project: AdminProjectRecord;
}) {
  const [versions, setVersions] = useState<DiskProjectVersionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    void loadAdminProjectVersions(project.projectId)
      .then((result) => {
        if (active) setVersions(result);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project.projectId]);

  return (
    <aside className="admin-workspace__drawer" aria-label="工程详情">
      <header>
        <div>
          <p>PROJECT DETAIL</p>
          <h2>{project.projectName}</h2>
          <span>{project.projectId}</span>
        </div>
        <button type="button" aria-label="关闭工程详情" onClick={onClose}><X size={20} /></button>
      </header>
      <div className="admin-workspace__drawer-body">
        <div className="admin-workspace__drawer-stats">
          <div><span>节点</span><strong>{project.nodeCount}</strong></div>
          <div><span>连线</span><strong>{project.edgeCount}</strong></div>
          <div><span>版本</span><strong>{versions.length}</strong></div>
        </div>
        <div className="admin-workspace__drawer-note">
          <HardDrives size={20} weight="duotone" />
          <span>
            <strong>{project.isAutosave ? '自动保存工程' : '本地磁盘工程'}</strong>
            <small>最近保存 {formatDate(project.updatedAt)}</small>
          </span>
        </div>
        <div className="admin-workspace__version-list">
          <div className="admin-workspace__version-heading">版本历史</div>
          {isLoading ? <p>正在读取版本…</p> : versions.map((version) => (
            <div key={version.id}>
              <span><Clock size={17} /></span>
              <span>
                <strong>{formatDate(version.savedAt)}</strong>
                <small>{version.nodeCount} 节点 · {version.edgeCount} 连线</small>
              </span>
            </div>
          ))}
          {!isLoading && !versions.length ? <p>暂无历史版本。</p> : null}
        </div>
      </div>
    </aside>
  );
}

export function AdminWorkspace({ onChanged, onClose }: AdminWorkspaceProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');
  const [data, setData] = useState<AdminWorkspaceData>(emptyData);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<AdminUserRecord | null>(null);
  const [selectedTask, setSelectedTask] = useState<AdminWorkspaceTask | null>(null);
  const [selectedProject, setSelectedProject] = useState<AdminProjectRecord | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setData(await loadAdminWorkspaceData());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const appRoot = document.getElementById('root');
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden');
    const wasInert = appRoot?.hasAttribute('inert') ?? false;
    const previousOverflow = document.body.style.overflow;

    closeButtonRef.current?.focus();
    appRoot?.setAttribute('aria-hidden', 'true');
    appRoot?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';

    return () => {
      if (appRoot) {
        if (previousAriaHidden == null) appRoot.removeAttribute('aria-hidden');
        else appRoot.setAttribute('aria-hidden', previousAriaHidden);
        if (!wasInert) appRoot.removeAttribute('inert');
      }
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (selectedUser || selectedTask || selectedProject) {
        setSelectedUser(null);
        setSelectedTask(null);
        setSelectedProject(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, selectedProject, selectedTask, selectedUser]);

  const refreshAll = async () => {
    await load();
    onChanged?.();
  };

  const selectSection = (section: AdminSection) => {
    setActiveSection(section);
    setSelectedUser(null);
    setSelectedTask(null);
    setSelectedProject(null);
  };

  return createPortal(
    <div className="admin-workspace nodrag nopan nowheel" role="dialog" aria-modal="true" aria-label="Studio 运营后台">
      <aside className="admin-workspace__sidebar">
        <div className="admin-workspace__brand">
          <span><ShieldCheck size={24} weight="duotone" /></span>
          <span><strong>STUDIO</strong><small>CONTROL</small></span>
        </div>
        <nav aria-label="后台管理">
          {sectionItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                aria-label={item.label}
                aria-current={activeSection === item.id ? 'page' : undefined}
                className={activeSection === item.id ? 'is-active' : ''}
                key={item.id}
                type="button"
                onClick={() => selectSection(item.id)}
              >
                <Icon size={20} weight={activeSection === item.id ? 'fill' : 'regular'} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="admin-workspace__sidebar-footer">
          <div>
            <span className={`admin-workspace__service-dot ${data.health.ok ? 'is-online' : 'is-offline'}`} />
            <span>
              <strong>{data.health.ok ? '系统运行正常' : '系统需要检查'}</strong>
              <small>{data.health.authMode === 'test-invite' ? '本地管理模式' : data.health.authMode}</small>
            </span>
          </div>
          <button type="button" aria-label="返回画布" onClick={onClose}>
            <ArrowLeft size={18} />
            <span>返回画布</span>
          </button>
        </div>
      </aside>

      <main className="admin-workspace__main">
        <header className="admin-workspace__topbar">
          <div>
            <span>Studio Canvas</span>
            <strong>{sectionItems.find((item) => item.id === activeSection)?.label}</strong>
          </div>
          <div>
            <span className="admin-workspace__environment"><span /> 本地环境</span>
            <button disabled={isLoading} type="button" onClick={() => void refreshAll()}>
              <ArrowClockwise className={isLoading ? 'is-spinning' : ''} size={18} />
              刷新数据
            </button>
            <button
              ref={closeButtonRef}
              className="admin-workspace__close"
              type="button"
              aria-label="关闭后台"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="admin-workspace__content" aria-busy={isLoading}>
          {isLoading && !data.projects.length && !data.tasks.length ? (
            <div className="admin-workspace__loading">
              <Pulse size={32} weight="duotone" />
              <strong>正在汇总运营数据…</strong>
              <span>读取工程、任务、用户和模型健康状态。</span>
            </div>
          ) : (
            <>
              {activeSection === 'overview' ? <OverviewPanel data={data} onNavigate={selectSection} /> : null}
              {activeSection === 'users' ? <UsersPanel data={data} onSelectUser={setSelectedUser} /> : null}
              {activeSection === 'jobs' ? <JobsPanel data={data} onSelectTask={setSelectedTask} /> : null}
              {activeSection === 'projects' ? <ProjectsPanel data={data} onSelectProject={setSelectedProject} /> : null}
              {activeSection === 'usage' ? <UsagePanel data={data} /> : null}
              {activeSection === 'system' ? <SystemPanel data={data} /> : null}
            </>
          )}
        </div>
      </main>

      {selectedUser ? (
        <UserDrawer
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onChanged={() => {
            void refreshAll();
          }}
        />
      ) : null}
      {selectedTask ? <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} /> : null}
      {selectedProject ? <ProjectDrawer project={selectedProject} onClose={() => setSelectedProject(null)} /> : null}
    </div>,
    document.body,
  );
}
