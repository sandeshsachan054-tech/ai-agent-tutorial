from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import re
import json
import asyncio
from dotenv import load_dotenv
load_dotenv()
from io import BytesIO
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from tools import search_tool

app = FastAPI(title="AI Research Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ResearchStreamRequest(BaseModel):
    query: str
    filter_type: str = "web"  # web, arxiv, github, news
    history_context: list[dict] = []  # [{"role": "user"|"assistant", "content": "..."}]

class ExportRequest(BaseModel):
    topic: str
    summary: str
    sources: list[str] = []

@app.post("/api/research/stream")
async def stream_research(request: ResearchStreamRequest):
    async def event_generator():
        # 1. Modify query according to filter
        search_query = request.query
        if request.filter_type == "arxiv":
            search_query += " site:arxiv.org OR site:semanticscholar.org"
        elif request.filter_type == "github":
            search_query += " site:github.com OR site:stackoverflow.com"
        elif request.filter_type == "news":
            search_query += " news recent updates 2025 2026"

        yield f"data: {json.dumps({'type': 'status', 'content': f'Searching {request.filter_type.upper()} sources...'})}\n\n"
        await asyncio.sleep(0.05)

        # 2. Search Web Tool
        search_data = search_tool.invoke(search_query)
        sources = re.findall(r"https?://(?:www\.)?([^/\s]+)", str(search_data))
        unique_sources = list(dict.fromkeys(sources))[:6]

        yield f"data: {json.dumps({'type': 'sources', 'sources': unique_sources, 'topic': request.query})}\n\n"
        await asyncio.sleep(0.05)

        # 3. LLM Setup with Conversation History Context
        
        
        system_prompt = (
            "You are an elite deep research intelligence agent. "
            "Provide an in-depth, structured, analytical report synthesizing the search context. "
            "Use clear headings, bullet points, and key findings. If this is a follow-up, answer in context."
        )
        
        messages = [("system", system_prompt)]
        for h in request.history_context:
            messages.append((h.get("role", "user"), h.get("content", "")))

        messages.append(("human", f"Current Query: {request.query}\nSearch Context:\n{search_data}"))
        llm = ChatGroq(model="openai/gpt-oss-20b", temperature=0.3, max_tokens=700, streaming=True)
        full_summary = ""
        async for chunk in llm.astream(messages):
            token = chunk.content
            if token:
                full_summary += token
                yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"

        # 4. Save to Persistent History File
        try:
            with open("research_output.txt", "a", encoding="utf-8") as f:
                f.write(f"\nGenerated on: Live Stream\nTopic: {request.query}\nSummary:\n{full_summary}\nSources: {unique_sources}\n{'='*40}\n")
        except Exception:
            pass

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/history")
async def get_history():
    if not os.path.exists("research_output.txt"):
        return []
    with open("research_output.txt", "r", encoding="utf-8") as f:
        raw_entries = f.read().split("Generated on: ")
    
    history_items = []
    for entry in raw_entries:
        if not entry.strip():
            continue
        topic_match = re.search(r"Topic:\s*(.*)", entry)
        topic = topic_match.group(1).strip() if topic_match else "Saved Research"
        summary_match = re.search(r"Summary:\s*([\s\S]*?)(?=Sources:|$)", entry)
        summary = summary_match.group(1).strip() if summary_match else ""
        history_items.append({"topic": topic, "summary": summary, "content": entry.strip()})
        
    return list(reversed(history_items))

@app.post("/api/export/markdown")
async def export_markdown(data: ExportRequest):
    md_content = f"# {data.topic}\n\n## Aggregated Summary\n\n{data.summary}\n\n"
    if data.sources:
        md_content += "## Referenced Sources\n\n"
        for s in data.sources:
            md_content += f"- https://{s}\n"
    
    return StreamingResponse(
        iter([md_content]),
        media_type="text/markdown",
        headers={"Content-Disposition": f"attachment; filename={data.topic.replace(' ', '_')}.md"}
    )

@app.post("/api/export/pdf")
async def export_pdf(data: ExportRequest):
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=40)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(name="TitleStyle", fontName="Helvetica-Bold", fontSize=18, leading=22, spaceAfter=12)
    heading_style = ParagraphStyle(name="HeadingStyle", fontName="Helvetica-Bold", fontSize=13, leading=16, spaceBefore=14, spaceAfter=6)
    body_style = ParagraphStyle(name="BodyStyle", fontName="Helvetica", fontSize=10, leading=14, spaceAfter=8)
    
    story = [
        Paragraph(data.topic, title_style),
        Spacer(1, 10),
        Paragraph("Executive Summary", heading_style),
        Paragraph(data.summary.replace("\n", "<br/>"), body_style),
        Spacer(1, 10),
    ]
    
    if data.sources:
        story.append(Paragraph("Referenced Sources", heading_style))
        for s in data.sources:
            story.append(Paragraph(f"• {s}", body_style))
            
    doc.build(story)
    buffer.seek(0)
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={data.topic.replace(' ', '_')}.pdf"}
    )