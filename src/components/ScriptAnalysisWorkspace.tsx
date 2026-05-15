import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  analyzeScript,
  downloadScriptAnalysisCsv,
  downloadScriptAnalysisJson,
  downloadScriptAnalysisMarkdown,
  downloadScriptAnalysisWorkbook,
} from '@/services/scriptAnalysisService';
import type { ScriptAnalysisResult, ScriptCharacter, ScriptProp, ScriptScene } from '@/types/scriptAnalysis';

type ScriptAnalysisWorkspaceProps = {
  onBackToCanvas: () => void;
};

type TabId = 'scenes' | 'characters' | 'props' | 'source';

const STORAGE_KEY = 'studio_canvas_script_analysis_workspace_v1';

function splitList(value: string): string[] {
  return value
    .split(/[,，、\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: string[]): string {
  return value.join('、');
}

function readStoredResult(): ScriptAnalysisResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ScriptAnalysisResult) : null;
  } catch {
    return null;
  }
}

function textPreview(text: string): string {
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

export function ScriptAnalysisWorkspace({ onBackToCanvas }: ScriptAnalysisWorkspaceProps) {
  const [projectName, setProjectName] = useState('未命名剧本');
  const [scriptText, setScriptText] = useState('');
  const [result, setResult] = useState<ScriptAnalysisResult | null>(() => readStoredResult());
  const [activeTab, setActiveTab] = useState<TabId>('scenes');
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (result) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
      setProjectName(result.projectName || '未命名剧本');
    }
  }, [result]);

  const stats = useMemo(() => {
    if (!result) {
      return [
        { label: '场景', value: '0' },
        { label: '角色', value: '0' },
        { label: '道具', value: '0' },
        { label: '文本', value: `${scriptText.length}` },
      ];
    }
    return [
      { label: '场景', value: String(result.scenes.length) },
      { label: '角色', value: String(result.characters.length) },
      { label: '道具', value: String(result.props.length) },
      { label: '文本', value: String(result.stats.textChars) },
    ];
  }, [result, scriptText.length]);

  const runAnalysis = async () => {
    const text = scriptText.trim();
    if (!text) {
      setMessage('请先粘贴剧本文本，或导入 txt / md 文件。');
      return;
    }
    setIsBusy(true);
    setMessage('正在分析剧本...');
    try {
      const nextResult = await analyzeScript({
        projectName: projectName.trim() || '未命名剧本',
        scriptText: text,
        sourceType: 'paste',
      });
      setResult(nextResult);
      setActiveTab('scenes');
      setMessage(nextResult.aiUsed ? 'AI 拆解完成，可以开始人工审核。' : '已完成规则拆解，AI 暂不可用时可先用它做底稿。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '剧本分析失败。');
    } finally {
      setIsBusy(false);
    }
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name)) {
      setMessage('第一版先支持 txt / md 文本文件；docx / pdf 会在下一步接入解析。');
      event.target.value = '';
      return;
    }
    const text = await file.text();
    setProjectName(file.name.replace(/\.(txt|md)$/i, '') || projectName);
    setScriptText(text);
    setMessage(`已导入 ${file.name}，可以开始分析。`);
    event.target.value = '';
  };

  const clearAll = () => {
    setScriptText('');
    setResult(null);
    setMessage('');
    localStorage.removeItem(STORAGE_KEY);
  };

  const updateScene = (sceneId: string, patch: Partial<ScriptScene>) => {
    setResult((current) =>
      current
        ? {
            ...current,
            scenes: current.scenes.map((scene) =>
              scene.id === sceneId ? { ...scene, ...patch, status: 'edited' } : scene,
            ),
          }
        : current,
    );
  };

  const updateCharacter = (characterId: string, patch: Partial<ScriptCharacter>) => {
    setResult((current) =>
      current
        ? {
            ...current,
            characters: current.characters.map((character) =>
              character.id === characterId ? { ...character, ...patch, status: 'edited' } : character,
            ),
          }
        : current,
    );
  };

  const updateProp = (propId: string, patch: Partial<ScriptProp>) => {
    setResult((current) =>
      current
        ? {
            ...current,
            props: current.props.map((prop) => (prop.id === propId ? { ...prop, ...patch, status: 'edited' } : prop)),
          }
        : current,
    );
  };

  return (
    <main className="script-analysis">
      <header className="script-analysis__topbar">
        <div>
          <p className="script-analysis__eyebrow">Script Analyzer</p>
          <h1>剧本分析</h1>
        </div>
        <div className="script-analysis__top-actions">
          <button type="button" onClick={onBackToCanvas}>
            返回画布
          </button>
          <button disabled={!result} type="button" onClick={() => result && downloadScriptAnalysisJson(result)}>
            导出 JSON
          </button>
          <button disabled={!result} type="button" onClick={() => result && downloadScriptAnalysisMarkdown(result)}>
            导出 Markdown
          </button>
          <button disabled={!result} type="button" onClick={() => result && downloadScriptAnalysisCsv(result)}>
            导出 CSV
          </button>
          <button disabled={!result} type="button" onClick={() => result && void downloadScriptAnalysisWorkbook(result)}>
            导出 Excel
          </button>
        </div>
      </header>

      <section className="script-analysis__summary" aria-label="分析统计">
        {stats.map((item) => (
          <div className="script-analysis__metric" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
        {result ? (
          <div className="script-analysis__mode">
            <span>{result.aiUsed ? 'AI 拆解' : '规则兜底'}</span>
            <strong>{result.modelUsed || 'local'}</strong>
          </div>
        ) : null}
      </section>

      <section className="script-analysis__workspace">
        <aside className="script-analysis__input">
          <label>
            项目名
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
          </label>
          <label>
            剧本文本
            <textarea
              value={scriptText}
              onChange={(event) => setScriptText(event.target.value)}
              placeholder="粘贴剧本文本。第一版会提取场景、角色、道具、时间地点，并保留来源片段。"
            />
          </label>
          <div className="script-analysis__input-actions">
            <button disabled={isBusy} type="button" onClick={runAnalysis}>
              {isBusy ? '分析中...' : '开始分析'}
            </button>
            <button disabled={isBusy} type="button" onClick={() => fileInputRef.current?.click()}>
              导入 TXT/MD
            </button>
            <button disabled={isBusy && !result} type="button" onClick={clearAll}>
              清空
            </button>
            <input ref={fileInputRef} hidden accept=".txt,.md,text/plain,text/markdown" type="file" onChange={onFileChange} />
          </div>
          {message ? <p className="script-analysis__message">{message}</p> : null}
          {result?.warnings.length ? (
            <div className="script-analysis__warnings">
              {result.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </aside>

        <section className="script-analysis__result">
          <nav className="script-analysis__tabs" aria-label="剧本分析结果">
            {[
              ['scenes', '场景表'],
              ['characters', '角色表'],
              ['props', '道具表'],
              ['source', '原文块'],
            ].map(([id, label]) => (
              <button
                aria-selected={activeTab === id}
                className={activeTab === id ? 'is-active' : ''}
                key={id}
                type="button"
                onClick={() => setActiveTab(id as TabId)}
              >
                {label}
              </button>
            ))}
          </nav>

          {!result ? (
            <div className="script-analysis__empty">
              <h2>先从一个可编辑底稿开始</h2>
              <p>粘贴剧本后点击开始分析。结果会在这里变成场景、角色、道具和原文依据，和画布功能完全分离。</p>
            </div>
          ) : null}

          {result && activeTab === 'scenes' ? (
            <div className="script-analysis__table-wrap">
              <table className="script-analysis__table">
                <thead>
                  <tr>
                    <th>场次</th>
                    <th>标题</th>
                    <th>地点/时间</th>
                    <th>人物</th>
                    <th>道具</th>
                    <th>摘要</th>
                    <th>依据</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scenes.map((scene) => (
                    <tr key={scene.id}>
                      <td>{scene.sceneNo}</td>
                      <td>
                        <input value={scene.title} onChange={(event) => updateScene(scene.id, { title: event.target.value })} />
                      </td>
                      <td>
                        <input
                          value={scene.location}
                          onChange={(event) => updateScene(scene.id, { location: event.target.value })}
                          placeholder="地点"
                        />
                        <input
                          value={scene.timeLabel}
                          onChange={(event) => updateScene(scene.id, { timeLabel: event.target.value })}
                          placeholder="时间"
                        />
                      </td>
                      <td>
                        <textarea
                          value={joinList(scene.characters)}
                          onChange={(event) => updateScene(scene.id, { characters: splitList(event.target.value) })}
                        />
                      </td>
                      <td>
                        <textarea
                          value={joinList(scene.props)}
                          onChange={(event) => updateScene(scene.id, { props: splitList(event.target.value) })}
                        />
                      </td>
                      <td>
                        <textarea
                          value={scene.summary}
                          onChange={(event) => updateScene(scene.id, { summary: event.target.value })}
                        />
                      </td>
                      <td title={scene.sourceText}>{textPreview(scene.sourceText)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {result && activeTab === 'characters' ? (
            <div className="script-analysis__table-wrap">
              <table className="script-analysis__table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>名称</th>
                    <th>别名</th>
                    <th>出现数</th>
                    <th>描述</th>
                    <th>依据</th>
                  </tr>
                </thead>
                <tbody>
                  {result.characters.map((character) => (
                    <tr key={character.id}>
                      <td>{character.id}</td>
                      <td>
                        <input value={character.name} onChange={(event) => updateCharacter(character.id, { name: event.target.value })} />
                      </td>
                      <td>
                        <input
                          value={joinList(character.aliases)}
                          onChange={(event) => updateCharacter(character.id, { aliases: splitList(event.target.value) })}
                        />
                      </td>
                      <td>{character.sceneCount}</td>
                      <td>
                        <textarea
                          value={character.description}
                          onChange={(event) => updateCharacter(character.id, { description: event.target.value })}
                        />
                      </td>
                      <td title={character.sourceText}>{textPreview(character.sourceText)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {result && activeTab === 'props' ? (
            <div className="script-analysis__table-wrap">
              <table className="script-analysis__table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>名称</th>
                    <th>类别</th>
                    <th>重要性</th>
                    <th>场景</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {result.props.map((prop) => (
                    <tr key={prop.id}>
                      <td>{prop.id}</td>
                      <td>
                        <input value={prop.name} onChange={(event) => updateProp(prop.id, { name: event.target.value })} />
                      </td>
                      <td>
                        <input value={prop.category} onChange={(event) => updateProp(prop.id, { category: event.target.value })} />
                      </td>
                      <td>{prop.importance}</td>
                      <td>{prop.sceneIds.join('、')}</td>
                      <td>
                        <textarea value={prop.notes} onChange={(event) => updateProp(prop.id, { notes: event.target.value })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {result && activeTab === 'source' ? (
            <div className="script-analysis__source-list">
              {result.textBlocks.map((block) => (
                <article key={block.id}>
                  <span>{block.id}</span>
                  <p>{block.text}</p>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
