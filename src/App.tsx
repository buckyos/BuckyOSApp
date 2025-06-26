import { useState, useRef, useEffect } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow, getAllWebviewWindows, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import "./App.css";
import { platform } from '@tauri-apps/plugin-os';

interface Page {
    id: number
    label: string
    url: string
}

function MainPage() {
    return (
        <div style={{
            display: 'flex',
            height: '100%',
            justifyContent: 'center',
            alignItems: 'center',
            fontSize: 28,
            color: '#555',
        }}>
            Welcome to BuckyOS！
        </div>
    )
}


function App() {
    const [greetMsg, setGreetMsg] = useState("");
    const [name, setName] = useState("BuckyOS");
    const [activeId, setActiveId] = useState<number>(0)
    const [pages, setPages] = useState<Page[]>([])
    const [labelInput, setLabelInput] = useState('')
    const [urlInput, setUrlInput] = useState('https://')
    const [showList, setShowList] = useState(false)
    const [isMobile, setIsMobile] = useState(false);

    const nextId = useRef(1)

    async function greet() {
        // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
        setGreetMsg(await invoke("greet", { name }));
    }

    function openPageMobile() {
        const label = labelInput.trim()
        const url = urlInput.trim()
        if (!label || !url) return

        if (pages.some(p => p.label === label)) {
            alert('Page with this label already exists!')
            return
        }

        const newPage: Page = {
            id: nextId.current++,
            label,
            url,
        }
        setPages(prev => [...prev, newPage])
        setActiveId(newPage.id)
        setLabelInput('')
        setUrlInput('https://')
    }

    function switchTo(id: number) {
        setActiveId(id)
        setShowList(false)
    }

    // 关闭页面（只能关 iframe，不关 MainPage）
    function closePage(id: number) {
        setPages(prev => prev.filter(p => p.id !== id))
        // 如果关的是当前激活页，切回 MainPage
        if (activeId === id) {
            setActiveId(0)
        }
        setShowList(false)
    }

    async function openPageDesktop() {
        const label = labelInput.trim()
        const url = urlInput.trim()
        if (!label || !url) return

        createWin(label, url);
    }


    async function getWin(label: string) {
        return await WebviewWindow.getByLabel(label)
    }

    async function createWin(label: string, url: string) {
        // 判断窗口是否存在
        const existWin = await getWin(label)
        if (existWin) {
            alert('Page with this label already exists!')
            // setfocus
            await existWin.setFocus();
            return;
        }
        // 创建窗口对象
        const win = new WebviewWindow(label, {
            url,
            title: label,
            width: 800,
            height: 600,
            resizable: true,
        })

        // 窗口创建完毕/失败
        win.once('tauri://created', async () => {
            console.log('tauri://created')
        })

        win.once('tauri://error', async (error) => {
            console.log('window create error!', error)
        })
    }

    async function openPage() {
        const platformName = platform();
        if (platformName === 'android' || platformName === 'ios') {
            openPageMobile()
        } else {
            openPageDesktop()
        }
    }

    useEffect(() => {
        async function checkPlatform() {
            const platformName = platform();
            setIsMobile(platformName === 'android' || platformName === 'ios');
        }
        checkPlatform();
    }, []);

    return (
        <div className="app-container">
            {/* 顶部输入区 */}
            <div className="toolbar">
                <div>
                    <input
                        value={labelInput}
                        onChange={e => setLabelInput(e.currentTarget.value)}
                        placeholder="label"
                    />
                </div>
                <div>
                    <input
                        value={urlInput}
                        onChange={e => setUrlInput(e.currentTarget.value)}
                        placeholder="https://..."
                    />
                </div>
                <button onClick={openPage}>OPEN</button>
            </div>

            {/* 中间内容区 */}
            <div className="iframe-wrapper">
                {activeId === 0
                    ? <MainPage />
                    : pages.map(p => (
                        <iframe
                            key={p.id}
                            src={p.url}
                            style={{ display: p.id === activeId ? 'block' : 'none' }}
                        />
                    ))
                }
            </div>

            {/* 底部管理栏 */}
            {isMobile && (
                <div className="bottom-bar">
                    <button onClick={() => setShowList(true)}>
                        {pages.length}
                    </button>
                </div>
            )}

            {/* 弹窗：MainPage + 各 iframe 标签 + 关闭按钮 */}
            {isMobile && showList && (
                <div className="modal-backdrop" onClick={() => setShowList(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h3>Pages</h3>
                        <ul className="page-list">
                            {/* 主页面标签 */}
                            <li
                                className={activeId === 0 ? 'active' : ''}
                                onClick={() => switchTo(0)}
                            >
                                MainPage
                            </li>
                            {/* 动态页面标签 */}
                            {pages.map(p => (
                                <li
                                    key={p.id}
                                    className={activeId === p.id ? 'active' : ''}
                                    onClick={() => switchTo(p.id)}
                                >
                                    <span>{p.label}</span>
                                    <button
                                        className="close-btn"
                                        onClick={e => {
                                            e.stopPropagation()
                                            closePage(p.id)
                                        }}
                                    >
                                        ×
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <button onClick={() => setShowList(false)}>Close</button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default App;
