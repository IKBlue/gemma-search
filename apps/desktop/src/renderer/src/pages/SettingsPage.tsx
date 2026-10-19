// SettingsPage —— 最小设置页（PRD-1 · M3 的「缺依赖跳设置」落点 · 所有者 2026-10-19 选“先做最小版”）
//
// 为什么要有这一页（PRD §6）：语义检索/以图搜图**默认关**；用户点这两个入口而系统还没模型/索引时，
// 不该只给一句"不可用"，而要落到能**看清缺什么、并当场处理**的页面。本页只做四件事：
//   ① 库：列出已登记的库（可用性如实显示）——库的增删仍走首启向导/诊断页，本页不重复造写入口；
//   ② 模型：写清**搜索顺序与目录形状**（静态指引；本页**不谎称**"检测过模型状态"——没有可靠检测接口）；
//   ③ 索引：复用 `useIndexTasks`（唯一实现）的开始/取消/续跑，不另写一套任务逻辑；
//   ④ 可选能力：如实写"默认关闭"；**开关的持久化需要新增 IPC（SETTINGS-2，待批）**，本页不假装能开。
//
// ⚠️ 本页不发任何写操作：索引三方法是既有契约；开关/库增删的写路径**不在本卡**（P6 边界写在 §④）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import AppShell from '../layout/AppShell.tsx';
import Main from '../layout/Main.tsx';
import PageHead from '../layout/PageHead.tsx';
import Topbar from '../layout/Topbar.tsx';
import Button from '../ui/Button.tsx';
import Toast from '../ui/Toast.tsx';
import SearchSidebar from '../search/SearchSidebar.tsx';
import { LABELS, PATHS } from '../router/paths.ts';
import useIndexTasks from '../hooks/useIndexTasks.ts';
import useLibraryConfig from '../hooks/useLibraryConfig.ts';
import useToast from '../hooks/useToast.ts';
import { useEngine } from '../hooks/useEngine.ts';
import { useDocumentTitle } from '../utils/useDocumentTitle.ts';
import type { IndexStatusData, LibStatus } from '../hooks/useEngine.ts';

export default function SettingsPage() {
  useDocumentTitle(LABELS.settings);
  const { invoke } = useEngine();
  const { message, tone, show } = useToast();
  const { data: libConfig, loading: libLoading, error: libError } = useLibraryConfig();
  const tasks = useIndexTasks(show);

  const [libs, setLibs] = useState<LibStatus[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [activeLib, setActiveLib] = useState('');

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    const r = await invoke<IndexStatusData>('indexStatus', {});
    setStatusLoading(false);
    if (!r.ok) {
      show(r.error.userMessage, 'err');
      return;
    }
    const list = r.data.libs || [];
    setLibs(list);
    setActiveLib((prev) =>
      prev && list.some((l) => l.libId === prev) ? prev : (list[0]?.libId ?? ''),
    );
  }, [invoke, show]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const active = useMemo(() => libs.find((l) => l.libId === activeLib) ?? null, [libs, activeLib]);

  return (
    <>
      <AppShell
        sidebar={<SearchSidebar lib={active} indexLoading={statusLoading} indexError={null} />}
      >
        <Main>
          <Topbar
            crumb={
              <>
                工作区 <span className="crumb-sep">/</span> <strong>设置</strong>
              </>
            }
            actions={
              <Button variant="icon" asChild>
                <Link to={PATHS.search} aria-label="返回搜索" title="返回搜索">
                  ←
                </Link>
              </Button>
            }
          />

          <div className="content" data-testid="settings-page">
            <PageHead
              eyebrow="SETTINGS"
              title="设置"
              subtitle="本地优先：素材不上传；语义检索与以图搜图是可选能力，需要模型与索引。这里能看到当前缺什么、并直接处理。"
            />

            {/* ① 库 */}
            <section className="panel mt-6" data-testid="settings-libraries">
              <div className="row mb-2">
                <b>素材库</b>
                <span className="u-flex1" />
                <span className="muted small">增删库仍走首次向导 / 诊断页（本页只读）</span>
              </div>
              {libLoading ? (
                <p className="muted small">正在读取库配置…</p>
              ) : libError ? (
                <p className="tone-err small">{libError}</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {(libConfig?.libraries ?? []).map((lib) => (
                    <li
                      key={lib.libId}
                      className="border-b border-line py-2 last:border-b-0"
                      data-lib={lib.libId}
                      data-available={lib.available === false ? 'no' : 'yes'}
                    >
                      <div className="flex items-center gap-2 text-caption">
                        <strong className="mono">{lib.libId}</strong>
                        <span className="muted small mono">{lib.root || '（无路径）'}</span>
                      </div>
                      {lib.available === false ? (
                        <div className="tone-err small">
                          {lib.unavailableReason || '库根当前不可用'}
                        </div>
                      ) : null}
                    </li>
                  ))}
                  {(libConfig?.libraries ?? []).length === 0 ? (
                    <li className="muted small">还没有登记任何库。</li>
                  ) : null}
                </ul>
              )}
            </section>

            {/* ② 模型（静态指引；不检测、不谎称检测） */}
            <section className="panel mt-6" data-testid="settings-model">
              <div className="row mb-2">
                <b>模型（语义检索 / 以图搜图需要）</b>
                <span className="u-flex1" />
                <span className="muted small">本页不检测模型状态</span>
              </div>
              <p className="muted small m-0">
                搜索顺序：<strong>用户指定 → 程序目录 → userData</strong>。把 ONNX 模型放到目录形如{' '}
                <code>models/embeddinggemma-2/&lt;rev&gt;/fp32/onnx/model.onnx</code>
                ，或在启动配置里指定 模型目录。模型缺失时，检索会返回 <code>MODEL_MISSING</code>
                （不会假装搜到结果）。
              </p>
            </section>

            {/* ③ 索引：复用既有任务 hook（开始/取消/续跑） */}
            <section className="panel mt-6" data-testid="settings-index">
              <div className="row mb-2">
                <b>索引任务</b>
                <span className="u-flex1" />
                <Button size="sm" asChild>
                  <Link to={PATHS.tasks}>打开任务中心</Link>
                </Button>
              </div>
              {statusLoading ? (
                <p className="muted small">正在读取索引状态…</p>
              ) : libs.length === 0 ? (
                <p className="muted small">没有可用的库状态。</p>
              ) : (
                <>
                  <div className="filter-row">
                    {libs.map((l) => (
                      <Button
                        key={l.libId}
                        size="sm"
                        variant={l.libId === activeLib ? 'primary' : undefined}
                        onClick={() => setActiveLib(l.libId)}
                        data-lib={l.libId}
                      >
                        {l.libId}
                        {l.healthy ? ' · 正常' : ' · 需处理'}
                      </Button>
                    ))}
                  </div>
                  <p className="muted small">
                    {active
                      ? `${active.libId}：已索引 ${active.indexed} 条 · 已编码 ${active.encoded} 条 · dim ${active.dim}` +
                        (active.compat ? ` · compat ${active.compat}` : '')
                      : '请选择库'}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      data-action="index-start"
                      disabled={!activeLib}
                      onClick={() => activeLib && void tasks.start(activeLib)}
                    >
                      开始索引
                    </Button>
                    <Button
                      size="sm"
                      data-action="index-cancel"
                      onClick={() => void tasks.cancel()}
                    >
                      取消
                    </Button>
                    <Button
                      size="sm"
                      data-action="index-resume"
                      onClick={() => void tasks.resume(activeLib)}
                    >
                      续跑
                    </Button>
                  </div>
                </>
              )}
            </section>

            {/* ④ 可选能力：默认关；开关持久化待批（SETTINGS-2） */}
            <section className="panel mt-6" data-testid="settings-optional">
              <div className="row mb-2">
                <b>可选能力</b>
                <span className="u-flex1" />
                <span className="muted small">默认关闭</span>
              </div>
              <p className="muted small m-0">
                语义检索（L1）与以图搜图（L2）是可选层：默认关，主流程（浏览 + 本地
                ID/文件名/路径检索） 不需要模型。⚠️ 开关的持久化需要新增一条应用设置读写方法（已登记
                TASKS SETTINGS-2，待批）， 本页不假装已经能保存开关。
              </p>
            </section>
          </div>
        </Main>
      </AppShell>
      <Toast message={message} tone={tone} />
    </>
  );
}
