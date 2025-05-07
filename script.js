const NODE_W = 135,
    NODE_H = 52,
    H_GAP = 49,
    V_GAP = 44,
    ANIM_MS = 200;
let collapseState = {},
    treeData = null,
    animating = false,
    lastSidebarId = null;

let zoomLevel = 1;
let panOffsetX = 0;
let panOffsetY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

function formatDecimal(value) {
    if (value === null || value === undefined) return "0";
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return num.toFixed(3);
}

document.getElementById("jsonFile").onclick = function () {
    this.value = null;
};
document
    .getElementById("jsonFile")
    .addEventListener("change", function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (evt) {
            try {
                collapseState = {};
                treeData = JSON.parse(evt.target.result);
                lastSidebarId = null;
                resetView();
                renderTree();
            } catch (e) {
                alert("Invalid JSON: " + e.message);
            }
        };
        reader.readAsText(file);
    });

document.getElementById("visualizeBtn").onclick = function () {
    const cusip = document.getElementById("cusipBox").value.trim();
    if (!cusip || !treeData) return;
    const node = findNodeByCUSIP(treeData, cusip);
    if (!node) {
        alert("CUSIP not found in tree.");
        return;
    }
    collapseState = {};
    expandPathToNode(treeData, cusip);
    lastSidebarId = null;
    resetView();
    renderTree(node);
};

function findNodeByCUSIP(node, cusip) {
    if (node.name === cusip) return node;
    let children = node.children || [];
    for (const c of children) {
        let found = findNodeByCUSIP(c, cusip);
        if (found) return found;
    }
    return null;
}

function expandPathToNode(root, cusip, parentId = "") {
    if (root.name === cusip) return true;
    let children = root.children || [];
    for (const c of children) {
        if (
            expandPathToNode(
                c,
                cusip,
                (parentId ? parentId + "|" : "") + root.name
            )
        ) {
            collapseState[(parentId ? parentId + "|" : "") + root.name] = false;
            return true;
        }
    }
    return false;
}

function layoutTree(node, x = 40, y = 40, parentId = "") {
    const id = (parentId ? parentId + "|" : "") + node.name;
    const collapsed = collapseState[id];
    let children = !collapsed && node.children ? node.children : [];

    let nodes = [],
        edges = [];

    nodes.push({ id, node, x, y, major: !!node.major_path });

    if (children.length) {
        children.sort((a, b) => {
            const aChange =
                typeof a.oad_contribution_pct === "number" && !isNaN(a.oad_contribution_pct)
                    ? a.oad_contribution_pct
                    : 0;
            const bChange =
                typeof b.oad_contribution_pct === "number" && !isNaN(b.oad_contribution_pct)
                    ? b.oad_contribution_pct
                    : 0;
            return bChange - aChange;
        });

        const nextX = x + NODE_W + H_GAP;
        let currentY = y;

        for (let i = 0; i < children.length; i++) {
            const { nodes: childNodes, edges: childEdges } = layoutTree(
                children[i],
                nextX,
                currentY,
                id
            );

            edges.push({
                from: { x: x + NODE_W, y: y + NODE_H / 2 },
                to: { x: nextX, y: currentY + NODE_H / 2 },
                major: !!children[i].major_path,
            });

            nodes = nodes.concat(childNodes);
            edges = edges.concat(childEdges);

            if (childNodes.length > 0) {
                const lowestY = Math.max(...childNodes.map((n) => n.y)) + NODE_H;
                currentY = lowestY + V_GAP;
            } else {
                currentY += NODE_H + V_GAP;
            }
        }
    }

    return { nodes, edges };
}

function createNodeBox(pos, openDetailSidebar) {
    const node = pos.node;
    const box = document.createElement("div");
    box.className =
        "nodebox" +
        (pos.major ? " major" : "") +
        (collapseState[pos.id] === false ? " expanded" : "");
    box.style.left = pos.x + "px";
    box.style.top = pos.y + "px";
    box.style.width = NODE_W + "px";

    const oadToday = formatDecimal(node.oad_today);
    const oadYesterday = formatDecimal(node.oad_yesterday);

    const oadContribution =
        node.oad_contribution_pct !== null && node.oad_contribution_pct !== undefined
            ? parseFloat(node.oad_contribution_pct)
            : 0;
    const changeClass =
        oadContribution > 0 ? "positive" : oadContribution < 0 ? "negative" : "";
    const changeDisplay =
        node.oad_contribution_pct !== null && node.oad_contribution_pct !== undefined
            ? (oadContribution > 0 ? "+" : "") +
            oadContribution.toFixed(3) +
            "%"
            : "0.000%";

    // loading bar value for the background
    const percent = Math.max(
        0,
        Math.min(100, node.oad_contribution_pct !== undefined && node.oad_contribution_pct !== null
            ? Math.abs(Number(node.oad_contribution_pct))
            : 0)
    );

    const arrow =
        node.children && node.children.length
            ? `<span class="toggle-arrow">&#9654;</span>`
            : "";

    box.innerHTML = `<div class="node-progress-bg" style="width:${percent}%;"></div>
    <div class="node-header">${arrow}${node.name}</div>
    <div class="cusip-label">${node.sec_group || ""}${node.sec_type ? " / " + node.sec_type : ""}${node.is_benchmark ? ` <span class="node-pill bench">Benchmark</span>` : ""}</div>
    <div class="node-body">
      <div class="node-key-value">
        <span class="node-key">OAD tdy:</span><span class="node-val">${oadToday}</span>
        <span class="node-key">Yday:</span><span class="node-val">${oadYesterday}</span>
        <span class="node-key">Δ Contr%:</span><span class="node-val ${changeClass}">${changeDisplay}</span>
      </div>
      ${node.error_message ? `<div class="node-error">${node.error_message}</div>` : ""}
    </div>`;

    box.tabIndex = 0;
    box.onclick = function (e) {
        if (isPanning) {
            e.stopPropagation();
            return;
        }
        if (node.children && node.children.length) {
            collapseState[pos.id] = !collapseState[pos.id];
            box.classList.toggle("expanded");

            animating = true;
            const affectedIds = findNodeBranchIds(node);
            affectedIds.forEach((id) => {
                const el = document.querySelector(`[data-node-id="${id}"]`);
                if (el) {
                    el.classList.remove("anim-show");
                    void el.offsetWidth;
                    el.classList.add("anim-hide");
                }
            });

            setTimeout(() => {
                renderTree();
                affectedIds.forEach((id) => {
                    const el = document.querySelector(`[data-node-id="${id}"]`);
                    if (el) el.classList.add("anim-show");
                });
                animating = false;
            }, ANIM_MS);
        }

        lastSidebarId = pos.id;
        openDetailSidebar(pos);
        e.stopPropagation();
    };

    box.setAttribute("data-node-id", pos.id);
    box.classList.add("anim-show");
    return box;
}

function findNodeBranchIds(node) {
    let out = [node.name];
    let children = node.children || [];
    for (const ch of children)
        out = out.concat(findNodeBranchIds(ch));
    return out;
}

function renderDetailSidebar(pos) {
    const node = pos.node;
    const sidebar = document.getElementById("sidePanel");
    const oadToday = formatDecimal(node.oad_today);
    const oadYesterday = formatDecimal(node.oad_yesterday);
    const oadContribution =
        node.oad_contribution_pct !== null && node.oad_contribution_pct !== undefined
            ? parseFloat(node.oad_contribution_pct)
            : 0;
    const changeSign = oadContribution >= 0 ? "+" : "";
    let html = `<button class="close-sidebar" onclick="document.getElementById('sidePanel').classList.remove('open')">&times;</button>`;
    html += `<h2 class="side-h2">${node.name}</h2>`;
    html += `<div class="side-kv"><span class="side-k">CUSIP</span><span class="side-v">${node.name}</span></div>`;
    if (node.cusip)
        html += `<div class="side-kv"><span class="side-k">Alt CUSIP</span><span class="side-v">${node.cusip}</span></div>`;
    html += `<div class="side-kv"><span class="side-k">SEC GROUP</span><span class="side-v">${node.sec_group || "-"
        }</span></div>`;
    html += `<div class="side-kv"><span class="side-k">SEC TYPE</span><span class="side-v">${node.sec_type || "-"
        }</span></div>`;
    html += `<div class="side-kv"><span class="side-k">OAD (Today)</span><span class="side-v">${oadToday}</span></div>`;
    html += `<div class="side-kv"><span class="side-k">OAD (Yday)</span><span class="side-v">${oadYesterday}</span></div>`;
    html += `<div class="side-kv"><span class="side-k">OAD Δ Contr%</span><span class="side-v">${changeSign}${oadContribution.toFixed(
        3
    )}%</span></div>`;
    html += `<div class="side-kv"><span class="side-k">Benchmark</span><span class="side-v">${node.is_benchmark ? "✔️" : "—"
        }</span></div>`;
    html += `<div class="side-kv"><span class="side-k">Major Path</span><span class="side-v">${node.major_path ? "✔️" : "—"
        }</span></div>`;
    if (node.children && node.children.length)
        html += `<div class="side-kv"><span class="side-k">Children</span><span class="side-v">${node.children.length
            }</span></div>`;
    if (node.error_message)
        html += `<div style="color:#e85663; margin:8px 0;"><strong>⚠️ Error:</strong> ${node.error_message}</div>`;
    html += `<div class="side-actions">
    <button onclick="expandBranch('${pos.id}');event.stopPropagation();">Expand Branch</button>
    <button onclick="collapseBranch('${pos.id}');event.stopPropagation();">Collapse Branch</button>
  </div>`;
    sidebar.innerHTML = html;
    sidebar.classList.add("open");
    sidebar.onclick = (e) => e.stopPropagation();
    window.expandBranch = function (id) {
        collapseState[id] = false;
        renderTree();
        openDetailsIfExists();
    };
    window.collapseBranch = function (id) {
        collapseState[id] = true;
        renderTree();
        openDetailsIfExists();
    };
}

function openDetailsIfExists() {
    if (lastSidebarId) {
        const nodes = Array.from(document.querySelectorAll(".nodebox"));
        for (const box of nodes) {
            if (box.getAttribute("data-node-id") === lastSidebarId) {
                const pos = {
                    node: getNodeById(treeData, lastSidebarId),
                    id: lastSidebarId,
                };
                renderDetailSidebar(pos);
                break;
            }
        }
    }
}

function getNodeById(node, id, parentId = "") {
    const thisID = (parentId ? parentId + "|" : "") + node.name;
    if (thisID === id) return node;
    let children = node.children || [];
    for (const c of children) {
        let found = getNodeById(c, id, thisID);
        if (found) return found;
    }
    return null;
}

function renderTree(rootOverride) {
    const cstack = document.getElementById("canvas-stack"),
        cinner = document.getElementById("nodeLayer"),
        svg = document.getElementById("edgesSVG"),
        sidebar = document.getElementById("sidePanel");
    cinner.innerHTML = "";
    svg.innerHTML = "";
    const root = rootOverride || treeData;
    if (!root) return;

    const { nodes, edges } = layoutTree(root);

    let allX = nodes.map((n) => n.x),
        allY = nodes.map((n) => n.y);
    let cW = Math.max(...allX, 0) + NODE_W + 180,
        cH = Math.max(...allY, 0) + NODE_H + 130;
    cstack.style.width = cW + "px";
    cstack.style.height = cH + "px";
    cinner.style.width = cW + "px";
    cinner.style.height = cH + "px";
    svg.setAttribute("width", cW);
    svg.setAttribute("height", cH);

    updateTransform();

    edges.forEach((e) => {
        svg.innerHTML += `<path 
      d="M${e.from.x},${e.from.y} 
         H${e.from.x + (e.to.x - e.from.x) / 2} 
         V${e.to.y} 
         H${e.to.x}" 
      stroke="${e.major ? "var(--edge-major)" : "var(--edge-main)"}" 
      stroke-width="2.1"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round" />`;
    });

    nodes.forEach((pos) => {
        let el = createNodeBox(pos, renderDetailSidebar);
        el.classList.add("anim-show");
        cinner.appendChild(el);
    });
    openDetailsIfExists();
}

// --- Zoom and pan functionality ---
function updateTransform() {
    const canvas = document.getElementById("canvas-stack");
    canvas.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px) scale(${zoomLevel})`;
    document.getElementById("zoom-level").textContent =
        Math.round(zoomLevel * 100) + "%";
}
function resetView() {
    zoomLevel = 1;
    panOffsetX = 0;
    panOffsetY = 0;
    updateTransform();
}
function zoomIn() {
    if (zoomLevel < 3) {
        zoomLevel = Math.min(3, zoomLevel + 0.1);
        updateTransform();
    }
}
function zoomOut() {
    if (zoomLevel > 0.2) {
        zoomLevel = Math.max(0.2, zoomLevel - 0.1);
        updateTransform();
    }
}
document.getElementById("zoom-in").addEventListener("click", zoomIn);
document.getElementById("zoom-out").addEventListener("click", zoomOut);
document.getElementById("zoom-reset").addEventListener("click", resetView);

document.getElementById("canvas-outer").addEventListener("wheel", function (e) {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
});
const canvasOuter = document.getElementById("canvas-outer");
canvasOuter.addEventListener("mousedown", function (e) {
    if (e.button === 0) {
        isPanning = true;
        startPanX = e.clientX - panOffsetX;
        startPanY = e.clientY - panOffsetY;
        document.body.classList.add("panning");
    }
});
document.addEventListener("mousemove", function (e) {
    if (isPanning) {
        panOffsetX = e.clientX - startPanX;
        panOffsetY = e.clientY - startPanY;
        updateTransform();
    }
});
document.addEventListener("mouseup", function () {
    isPanning = false;
    document.body.classList.remove("panning");
});
document.addEventListener("mouseleave", function () {
    isPanning = false;
    document.body.classList.remove("panning");
});
document.addEventListener("keydown", function (e) {
    if (e.key === "+" || e.key === "=") zoomIn();
    else if (e.key === "-" || e.key === "_") zoomOut();
    else if (e.key === "0") resetView();
    else if (e.key === "ArrowUp") {
        panOffsetY += 50;
        updateTransform();
    } else if (e.key === "ArrowDown") {
        panOffsetY -= 50;
        updateTransform();
    } else if (e.key === "ArrowLeft") {
        panOffsetX += 50;
        updateTransform();
    } else if (e.key === "ArrowRight") {
        panOffsetX -= 50;
        updateTransform();
    }
});
document.getElementById("sidePanel").onclick = (e) => e.stopPropagation();
document.body.onclick = () => { };