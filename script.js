const NODE_W = 160, // Fixed width for nodes
    NODE_H = 85,      // Fixed height
    H_GAP = 60,       // Reduced horizontal gap
    V_GAP = 20,       // Reduced vertical gap
    ANIM_MS = 250;    // Animation duration

let collapseState = {},
    treeData = null,
    animating = false,
    lastSidebarId = null;

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
    renderTree(node);
};

function findNodeByCUSIP(node, cusip) {
    if (node.name === cusip) return node;
    if (node.children)
        for (const c of node.children) {
            let found = findNodeByCUSIP(c, cusip);
            if (found) return found;
        }
    return null;
}

function expandPathToNode(root, cusip, parentId = "") {
    if (root.name === cusip) return true;
    if (!root.children) return false;
    for (const c of root.children) {
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

// Improved layout function with optimized spacing
function layoutTree(node, x = 40, y = 40, parentId = "") {
    const id = (parentId ? parentId + "|" : "") + node.name;
    const collapsed = collapseState[id];
    const children = !collapsed && node.children ? node.children : [];

    let nodes = [],
        edges = [];

    // Add this node
    nodes.push({ id, node, x, y, major: !!node.major_path });

    if (children.length) {
        // Next column position
        const nextX = x + NODE_W + H_GAP;
        let currentY = y;

        for (let i = 0; i < children.length; i++) {
            // Layout this child branch
            const { nodes: childNodes, edges: childEdges } =
                layoutTree(children[i], nextX, currentY, id);

            // Add edge from parent to this child
            edges.push({
                from: {
                    x: x + NODE_W,
                    y: y + NODE_H / 2
                },
                to: {
                    x: nextX,
                    y: currentY + NODE_H / 2
                },
                major: !!children[i].major_path
            });

            // Add child nodes and edges to result
            nodes = nodes.concat(childNodes);
            edges = edges.concat(childEdges);

            // Update Y position for next child with reduced spacing
            if (childNodes.length > 0) {
                // Find the lowest node in this branch
                const lowestY = Math.max(...childNodes.map(n => n.y)) + NODE_H;
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
    box.className = "nodebox" + (pos.major ? " major" : "") + (collapseState[pos.id] === false ? " expanded" : "");
    box.style.left = pos.x + "px";
    box.style.top = pos.y + "px";

    // Format the OAD change
    const oadChange = typeof node.oad_change_pct !== "undefined"
        ? node.oad_change_pct : null;
    const oadChangeClass = oadChange > 0 ? 'positive' : 'negative';
    const oadChangeDisplay = oadChange
        ? `<span class="${oadChangeClass}">${oadChange > 0 ? '+' : ''}${oadChange}%</span>`
        : "-";

    // Arrow icon for expandable nodes
    const arrow = node.children && node.children.length
        ? `<div class="toggle-arrow">›</div>`
        : "";

    box.innerHTML = `
    <div class="node-header">
      <div class="node-title">${node.name}</div>
      ${arrow}
    </div>
    
    <div class="node-metadata">
      ${node.sec_group ? `<span class="node-meta-item">${node.sec_group}</span>` : ''}
      ${node.sec_type ? `<span class="node-meta-item">${node.sec_type}</span>` : ''}
    </div>
    
    <div class="node-metrics">
      <div class="metric-group">
        <span class="metric-label">OAD Today</span>
        <span class="metric-value">${node.oad_today ?? "-"}</span>
      </div>
      <div class="metric-group">
        <span class="metric-label">Change</span>
        <span class="metric-value">${oadChangeDisplay}</span>
      </div>
    </div>
    
    <div class="node-badges">
      ${node.is_benchmark ? `<span class="node-pill bench">Benchmark</span>` : ''}
    </div>
  `;

    box.tabIndex = 0;
    box.onclick = function (e) {
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
    if (node.children)
        for (const ch of node.children)
            out = out.concat(findNodeBranchIds(ch));
    return out;
}

function renderDetailSidebar(pos) {
    const node = pos.node;
    const sidebar = document.getElementById("sidePanel");

    // Format the OAD change for sidebar
    const oadChangeStr = typeof node.oad_change_pct !== "undefined"
        ? (node.oad_change_pct > 0 ? "+" : "") + node.oad_change_pct + "%"
        : "-";

    let html = `<button class="close-sidebar" onclick="document.getElementById('sidePanel').classList.remove('open')">&times;</button>`;
    html += `<h2 class="side-h2">${node.name}</h2>`;
    html += `<div class="side-kv"><span class="side-k">CUSIP</span><span class="side-v">${node.name}</span></div>`;
    if (node.cusip)
        html += `<div class="side-kv"><span class="side-k">Alt CUSIP</span><span class="side-v">${node.cusip}</span></div>`;
    html += `<div class="side-kv"><span class="side-k">SEC GROUP</span><span class="side-v">${node.sec_group || "-"
        }</span></div>`;
    html += `<div class="side-kv"><span class="side-k">SEC TYPE</span><span class="side-v">${node.sec_type || "-"
        }</span></div>`;
    html += `<div class="side-kv"><span class="side-k">OAD (Today)</span><span class="side-v">${node.oad_today ?? "-"
        }</span></div>`;
    html += `<div class="side-kv"><span class="side-k">OAD (Yday)</span><span class="side-v">${node.oad_yesterday ?? "-"
        }</span></div>`;
    html += `<div class="side-kv"><span class="side-k">OAD Δ %</span><span class="side-v">${oadChangeStr}</span></div>`;
    html += `<div class="side-kv"><span class="side-k">Benchmark</span><span class="side-v">${node.is_benchmark ? "✔️" : "—"
        }</span></div>`;
    html += `<div class="side-kv"><span class="side-k">Major Path</span><span class="side-v">${node.major_path ? "✔️" : "—"
        }</span></div>`;
    if (node.children && node.children.length)
        html += `<div class="side-kv"><span class="side-k">Children</span><span class="side-v">${node.children.length}</span></div>`;
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
    if (node.children)
        for (const c of node.children) {
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

    // Use the improved layout function
    const { nodes, edges } = layoutTree(root);

    // Calculate canvas dimensions
    let allX = nodes.map((n) => n.x),
        allY = nodes.map((n) => n.y);
    let cW = Math.max(...allX, 0) + NODE_W + 180,
        cH = Math.max(...allY, 0) + NODE_H + 130;

    // Set canvas dimensions
    cstack.style.width = cW + "px";
    cstack.style.height = cH + "px";
    cinner.style.width = cW + "px";
    cinner.style.height = cH + "px";
    svg.setAttribute("width", cW);
    svg.setAttribute("height", cH);

    // Draw edges with right-angle connections
    edges.forEach((e) => {
        // Draw edge with right angles
        svg.innerHTML += `<path 
      d="M${e.from.x},${e.from.y} 
         H${e.from.x + (e.to.x - e.from.x) / 2} 
         V${e.to.y} 
         H${e.to.x}" 
      stroke="${e.major ? "var(--edge-major)" : "var(--edge-main)"}" 
      stroke-width="2"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round" />`;

        // Add endpoint circle
        svg.innerHTML += `<circle 
      cx="${e.to.x}" 
      cy="${e.to.y}" 
      r="3" 
      fill="${e.major ? "var(--edge-major)" : "var(--edge-main)"}" />`;
    });

    // Create all nodes
    nodes.forEach((pos) => {
        let el = createNodeBox(pos, renderDetailSidebar);
        el.classList.add("anim-show");
        cinner.appendChild(el);
    });

    openDetailsIfExists();
}

document.getElementById("sidePanel").onclick = (e) => e.stopPropagation();
document.body.onclick = () => { }; // Disable sidebar autoclose