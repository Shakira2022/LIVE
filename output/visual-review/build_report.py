from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'Team_1_and_Team_5_Changes_Report.docx'
FONT = 'Aptos'

def set_cell_shading(cell, color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd'); shd.set(qn('w:fill'), color); tcPr.append(shd)

def set_cell_margins(cell, top=110, start=130, bottom=110, end=130):
    tc = cell._tc; tcPr = tc.get_or_add_tcPr()
    mar = OxmlElement('w:tcMar')
    for tag, val in [('top',top),('start',start),('bottom',bottom),('end',end)]:
        node=OxmlElement('w:'+tag); node.set(qn('w:w'),str(val)); node.set(qn('w:type'),'dxa'); mar.append(node)
    tcPr.append(mar)

def set_repeat_table_header(row):
    trPr=row._tr.get_or_add_trPr(); repeat=OxmlElement('w:tblHeader'); repeat.set(qn('w:val'),'true'); trPr.append(repeat)

def font_file(bold=False):
    candidates = [Path('C:/Windows/Fonts/segoeuib.ttf' if bold else 'C:/Windows/Fonts/segoeui.ttf'), Path('C:/Windows/Fonts/arialbd.ttf' if bold else 'C:/Windows/Fonts/arial.ttf')]
    for p in candidates:
        if p.exists(): return str(p)
    return None

def draw_screen(path, role, title, subtitle, rows, left_label='LIVE', right_label='Overview'):
    W,H=1300,810
    im=Image.new('RGB',(W,H),'#f5f8fa'); d=ImageDraw.Draw(im)
    reg=ImageFont.truetype(font_file() or 'arial.ttf',24)
    small=ImageFont.truetype(font_file() or 'arial.ttf',18)
    bold=ImageFont.truetype(font_file(True) or 'arialbd.ttf',28)
    tiny=ImageFont.truetype(font_file() or 'arial.ttf',16)
    d.rectangle((0,0,W,84),fill='#123d4b'); d.text((44,24),left_label,font=bold,fill='white'); d.text((W-280,29),role,font=small,fill='#d7e8ee')
    d.text((50,120),title,font=bold,fill='#153b4b'); d.text((50,166),subtitle,font=small,fill='#637987')
    y=226
    for row in rows:
        kind,label,*rest=row
        detail=rest[0] if rest else ''
        if kind=='metric':
            x=50
            for metric,val in [(label,detail),('Organisations','9'),('Active requests','10'),('Denied events','147')]:
                d.rounded_rectangle((x,y,x+280,y+112),radius=15,fill='white',outline='#d5e0e5',width=2)
                d.text((x+18,y+17),metric,font=tiny,fill='#57717e'); d.text((x+18,y+48),val,font=bold,fill='#143e4c'); x+=300
            y+=142
        elif kind=='filter':
            d.rounded_rectangle((50,y,1250,y+62),radius=10,fill='white',outline='#d5e0e5',width=2)
            d.text((72,y+19),label+'     All results     Success     Denied     Warning     Failure',font=small,fill='#355361'); y+=88
        elif kind=='section':
            d.text((55,y),label,font=bold,fill='#173c4a'); y+=49
        elif kind=='table':
            headers=label.split('|'); widths=[210,180,220,180,160,180]
            d.rounded_rectangle((50,y,1250,y+48),radius=5,fill='#dce9ed')
            xx=62
            for i,h in enumerate(headers): d.text((xx,y+14),h,font=tiny,fill='#244d5b'); xx+=widths[min(i,len(widths)-1)]
            y+=50
            for n,entry in enumerate(detail.split('\n')):
                d.rectangle((50,y,1250,y+57),fill='white' if n%2==0 else '#f0f5f7',outline='#e2e9ec')
                vals=entry.split('|'); xx=62
                for i,val in enumerate(vals):
                    d.text((xx,y+17),val[:25],font=tiny,fill='#48616d'); xx+=widths[min(i,len(widths)-1)]
                y+=58
        elif kind=='log':
            entries=(detail or label).split('\n')
            for n,entry in enumerate(entries):
                d.rounded_rectangle((50,y,1250,y+88),radius=8,fill='white',outline='#d5e0e5',width=2)
                d.ellipse((70,y+30,92,y+52),fill=['#25a57b','#d6a43b','#5389a0'][n%3])
                d.text((112,y+15),entry[:88],font=small,fill='#294c59')
                d.text((112,y+49),'Time  •  Actor / service  •  Result  •  Expand for technical details',font=tiny,fill='#78909b')
                y+=103
        elif kind=='health':
            d.rounded_rectangle((50,y,1250,y+170),radius=12,fill='white',outline='#d5e0e5',width=2)
            d.text((75,y+20),label,font=bold,fill='#244d5b'); d.text((75,y+79),detail,font=small,fill='#51707c'); y+=190
    d.text((50,H-43),f'Source-based screen reconstruction  ·  {right_label}',font=tiny,fill='#81949d')
    im.save(path)

screens = {
 'admin_overview.png':('ADMIN','System overview','Platform activity and service health',[
  ('metric','Users','29'),('section','Latest audit activity'),('log','Recent administrative events\nOrganisation status update\nUser access changed'),('health','Platform health','Connected services and system checks')],'LIVE','Admin overview'),
 'admin_audit.png':('ADMIN','Audit trail','Review administrative and security events',[
  ('filter','Filter events'),('section','Event records'),('table','Time|Actor|Action|Target|ID|Result','09:42|Admin|Changed status|Organisation|c81…|Success\n09:16|Manager|Updated profile|User|a42…|Success\n08:53|System|Access denied|Admin route|e16…|Denied\n08:21|Admin|Created organisation|Organisation|d30…|Success')],'LIVE','Admin audit'),
 'auditor_application.png':('AUDITOR','Application logs','Application events, services, and errors',[
  ('filter','Filter logs'),('section','Application events'),('log','API request completed\nService health check passed\nValidation error recorded\nBackground task finished')],'LIVE','Application logs'),
 'auditor_audit.png':('AUDITOR','Audit logs','Approved security and operational events',[
  ('filter','Filter audit events'),('section','Audit records'),('log','User signed in\nRequest assigned to responder\nOrganisation settings changed\nPermission check denied')],'LIVE','Auditor audit'),
 'auditor_integration.png':('AUDITOR','Integration logs','External provider operations and outcomes',[
  ('filter','Filter integrations'),('section','Integration operations'),('log','SMS provider · Delivered · HTTP 200\nMaps provider · Completed · HTTP 200\nTranslation service · Failed · HTTP 503')],'LIVE','Integration logs'),
 'auditor_security.png':('AUDITOR','Security logs','Review security events and access outcomes',[
  ('filter','Filter security events'),('section','Security events'),('log','Successful sign-in\nPermission denied\nAccount settings updated\nSession expired')],'LIVE','Security logs')
}
for name, args in screens.items(): draw_screen(ROOT/name,*args)

doc=Document()
sec=doc.sections[0]; sec.top_margin=Inches(.62); sec.bottom_margin=Inches(.62); sec.left_margin=Inches(.72); sec.right_margin=Inches(.72)
styles=doc.styles
styles['Normal'].font.name=FONT; styles['Normal'].font.size=Pt(10.5); styles['Normal'].font.color.rgb=RGBColor(42,58,66)
styles['Normal'].paragraph_format.space_after=Pt(5)
for sty,size in [('Title',30),('Heading 1',21),('Heading 2',15),('Heading 3',11)]:
    s=styles[sty]; s.font.name=FONT; s.font.size=Pt(size); s.font.bold=True; s.font.color.rgb=RGBColor(0,0,0)
    s.paragraph_format.space_before=Pt(8); s.paragraph_format.space_after=Pt(6)
header=sec.header.paragraphs[0]; header.text='LIVE RESPONSE APP  /  CHANGE REVIEW'; header.alignment=WD_ALIGN_PARAGRAPH.RIGHT
for r in header.runs: r.font.name=FONT; r.font.size=Pt(8); r.font.color.rgb=RGBColor(93,117,128)
footer=sec.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.CENTER
r=footer.add_run('Team archive comparison  •  4 November 2026'); r.font.name=FONT; r.font.size=Pt(8); r.font.color.rgb=RGBColor(93,117,128)

def p(text='',style=None): return doc.add_paragraph(text,style)
def bullets(items):
    for item in items: doc.add_paragraph(item,style='List Bullet')
def heading(text,level=1): doc.add_heading(text,level)
def add_table(headers,rows,widths=None):
    t=doc.add_table(rows=1,cols=len(headers)); t.style='Table Grid'; t.autofit=False
    set_repeat_table_header(t.rows[0])
    for i,h in enumerate(headers):
        c=t.rows[0].cells[i]; c.text=h; set_cell_shading(c,'174B5B'); set_cell_margins(c)
        for rr in c.paragraphs[0].runs: rr.font.bold=True; rr.font.color.rgb=RGBColor(255,255,255); rr.font.size=Pt(9)
    for ri,row in enumerate(rows):
        cells=t.add_row().cells
        for i,val in enumerate(row):
            cells[i].text=val; set_cell_margins(cells[i])
            if ri%2==1: set_cell_shading(cells[i],'EEF4F6')
            for pp in cells[i].paragraphs:
                pp.paragraph_format.space_after=Pt(1)
                for rr in pp.runs: rr.font.size=Pt(9)
    if widths:
        for row in t.rows:
            for i,w in enumerate(widths): row.cells[i].width=Inches(w)
    doc.add_paragraph().paragraph_format.space_after=Pt(2)
    return t

# Page 1
p('Team 1 and Team 5 Changes', 'Title')
p('What each supplied archive contains, what the screens show, and how the files compare with the current workspace.')
heading('The short answer',1)
p('Team 1 is not only a cancel button. Its archive describes a wider requester-side update covering request creation, the home screen, live tracking, history, labels, and profile navigation. The cancellation flow is one prominent addition. Team 5 contains six admin and auditor pages for dashboards, audit records, application logs, integrations, and security events.')
p('The two archives touch different app areas: Team 1 focuses on requester experience; Team 5 focuses on administrative and read-only oversight screens. The supplied Team 1 document includes four real interface images. Team 5 supplies code only, so the six Team 5 visuals in this report are labelled reconstructions based on that code.')
heading('At a glance',2)
add_table(['Archive','Scope','Included files / evidence'],[
 ('Team1.zip','Requester experience','Requester home, new request, live tracking, request history, profile, shared request/map components, plus Team1.docx with 4 embedded screenshots.'),
 ('Team 5 Tsholo and Nqobile.zip','Admin and auditor oversight','6 page source files: admin overview and audit trail; auditor application, audit, integration, and security logs. No screenshots or design document included.')],[1.35,1.6,4.1])
heading('What this report means by “screen”',2)
p('For Team 1, the report reproduces the supplied screenshots. For Team 5, it shows clean visual reconstructions of the page structure represented by the source files. Those reconstructions explain the screen contents; they are not captured screenshots of a running app.')

# Team 1 overview
doc.add_page_break(); heading('Team 1  Requester experience',1)
p('The archive’s accompanying Team1.docx frames the work as targeted requester UX improvements. The source set includes home, request creation, tracking, history, profile, map, request details, request list, shared labels, and utilities.')
heading('What Team 1 reports building',2)
bullets([
 'Requester home: add a cancellation action to the active-request panel; improve mobile scrolling between the map and panel; move Ask LIVE AI into the top header and make it easier to notice.',
 'Friendly request language: show readable labels such as “En route” instead of internal values such as en_route, without changing stored database values.',
 'Live tracking: make cancellation available on desktop and mobile, add friendlier status and activity labels, and provide a Back action.',
 'Request history: improve singular/plural wording, provide a Back to Home route, and make category and status labels easier to understand.',
 'New request: improve selected-option styling, reduce accidental text selection, and let users skip questions with a confirmation that accurately describes what will happen.',
 'Cancellation flow: show a confirmation sheet with reasons such as no longer needing help, a mistaken request, help already arriving, or another reason; explain that the request remains active until staff confirm cancellation.',
 'Profile and shared components: add a Back action and use consistent friendly status labels and visual tones across request lists, detail sheets, and the map.'
])
heading('Team 1 source files in the archive',2)
add_table(['Screen / area','Files represented'],[
 ('Home and request creation','app/app/requester/page.tsx; app/app/requester/new/page.tsx'),
 ('Tracking and history','app/app/requester/track/[id]/page.tsx; app/app/requester/history/page.tsx'),
 ('Profile and shared display','components/requester/profile-content.tsx; components/requests/request-details-sheet.tsx; components/requests/request-list-item.tsx'),
 ('Map and shared helpers','components/maps/live-response-map.tsx; components/requester/cancel-request-button.tsx; lib/display-labels.ts; lib/utils.ts')],[2.05,5.0])

# Team 1 screenshots two per page
team1_caps=[
 ('team1-docx-image-1.png','Requester home with an active request. The panel includes request status, tracking access, cancellation, and the LIVE AI entry point.'),
 ('team1-docx-image-2.png','Cancellation confirmation sheet with a reason selector and options to cancel or return.'),
 ('team1-docx-image-3.png','After submission, the message clarifies that the request remains active until staff confirm cancellation.'),
 ('team1-docx-image-4.png','Notifications page showing the page navigation and notification state.')]
for start in [0,2]:
    doc.add_page_break(); heading('Team 1 screens  '+('Home and cancellation' if start==0 else 'Cancellation result and notifications'),1)
    for name,caption in team1_caps[start:start+2]:
        path=ROOT/name
        if path.exists():
            pic=doc.add_picture(str(path),width=Inches(5.9)); doc.paragraphs[-1].alignment=WD_ALIGN_PARAGRAPH.CENTER
            cp=p(caption); cp.alignment=WD_ALIGN_PARAGRAPH.CENTER
            for rr in cp.runs: rr.font.size=Pt(9); rr.font.italic=True; rr.font.color.rgb=RGBColor(83,103,113)
            doc.add_paragraph().paragraph_format.space_after=Pt(2)

# Team 5 inventory
doc.add_page_break(); heading('Team 5  Admin and auditor screens',1)
p('Team 5’s ZIP contains six page implementations. The admin pages are for system operators. The auditor pages focus on reviewing operational, application, integration, and security records. The auditor views are presented as read-only log review screens in the supplied source.')
add_table(['Screen','What is represented in the source'],[
 ('Admin system overview','Summary cards for users, organisations, active requests, and denied events; latest audit activity with a View all route; platform health/service checks.'),
 ('Admin audit trail','Result filters for all, success, denied, warning, and failure; event count; responsive records with time, actor, action, target, correlation details, result, and expandable safe metadata.'),
 ('Auditor application logs','Application/service events and errors, with event level, message, time, and expandable technical details.'),
 ('Auditor audit logs','Security and operational audit events with actor, target, time, result, and expandable technical metadata.'),
 ('Auditor integration logs','Provider operations with outcome, HTTP status, error detail, and expandable endpoint/request/correlation information.'),
 ('Auditor security logs','Security events with user/system context, timestamp, result, and expandable event type, user, IP, correlation, and user-agent details.')],[1.7,5.35])
heading('Team 5 source files',2)
add_table(['Screen','Archive path'],[
 ('Admin audit trail','app/app/admin/audit/page.tsx'),('Admin overview','app/app/admin/page.tsx'),
 ('Auditor application logs','app/app/auditor/application/page.tsx'),('Auditor audit logs','app/app/auditor/audit/page.tsx'),
 ('Auditor integration logs','app/app/auditor/integration/page.tsx'),('Auditor security logs','app/app/auditor/security/page.tsx')],[2.1,4.95])

for start, title in [(0,'Team 5 screens  Admin'),(2,'Team 5 screens  Auditor logs'),(4,'Team 5 screens  Security and integrations')]:
    doc.add_page_break(); heading(title,1)
    for name in list(screens.keys())[start:start+2]:
        img=ROOT/name
        doc.add_picture(str(img),width=Inches(5.9)); doc.paragraphs[-1].alignment=WD_ALIGN_PARAGRAPH.CENTER
        captions={
         'admin_overview.png':'Admin system overview reconstruction from app/app/admin/page.tsx.',
         'admin_audit.png':'Admin audit trail reconstruction from app/app/admin/audit/page.tsx.',
         'auditor_application.png':'Application log reconstruction from app/app/auditor/application/page.tsx.',
         'auditor_audit.png':'Auditor audit log reconstruction from app/app/auditor/audit/page.tsx.',
         'auditor_integration.png':'Integration log reconstruction from app/app/auditor/integration/page.tsx.',
         'auditor_security.png':'Security log reconstruction from app/app/auditor/security/page.tsx.'}
        cp=p(captions[name]); cp.alignment=WD_ALIGN_PARAGRAPH.CENTER
        for rr in cp.runs: rr.font.size=Pt(9); rr.font.italic=True; rr.font.color.rgb=RGBColor(83,103,113)
        doc.add_paragraph().paragraph_format.space_after=Pt(1)

# Comparison
doc.add_page_break(); heading('How the archives compare with the current workspace',1)
p('The archive paths were checked against the same paths in the current project. File sizes and differences show that the submitted files are alternate versions, not unchanged copies. The summaries below describe overlaps and gaps; they do not claim that the supplied ZIP is already merged into the current app.')
add_table(['Area','Archive versus workspace','Practical reading'],[
 ('Team 1 requester','The requester pages and shared map/request components differ substantially. The archive also contains cancel-request-button.tsx and display-labels.ts, which are absent at those paths in the current workspace.','Team 1 includes many changes beyond cancellation. The dedicated confirmation action/helper is not present in the current workspace under those paths. Some related requester navigation and status-formatting behavior already exists in current code through other helpers.'),
 ('Team 5 admin/auditor','All six page paths exist in both archive and workspace, but each differs. Some archive versions format audit/security actions into friendlier labels. Current admin page includes per-tab client caching; current audit/security pages differ in how event labels and detail fields are displayed.','These are competing revisions of existing pages. Review and merge specific changes deliberately; replacing whole pages could discard current workspace improvements.')],[1.45,2.9,2.7])
heading('File-level comparison',2)
add_table(['Team 1 file','ZIP lines','Workspace lines','Diff summary'],[
 ('requester home','935','1,473','+795 / −257'),('new request','717','1,903','+1,584 / −398'),('live tracking','809','1,160','+701 / −350'),('request history','307','486','+259 / −80'),('map component','605','1,551','+1,082 / −136')],[2.1,1.0,1.2,1.65])
add_table(['Team 5 file','ZIP lines','Workspace lines','Diff summary'],[
 ('admin audit','482','475','+192 / −199'),('admin overview','532','514','+18 / −36'),('auditor application','374','333','+47 / −88'),('auditor audit','397','310','+6 / −93'),('auditor integration','326','325','+116 / −117'),('auditor security','363','308','+8 / −63')],[2.1,1.0,1.2,1.65])
heading('What to take away',2)
bullets([
 'Team 1 delivered a broader requester UX set; cancellation is only one item in that set.',
 'Team 5 delivered six admin/auditor monitoring and log-review pages; it does not overlap Team 1’s requester source paths.',
 'Team 1’s supplied document provides genuine screenshots. Team 5’s supplied archive has no screenshots; its visuals here are source-derived reconstructions.',
 'The archives are not simply “already applied.” They contain alternate code relative to current paths, so their changes should be reviewed feature by feature before any merge or replacement.'
])

doc.core_properties.title='Team 1 and Team 5 Changes'
doc.core_properties.subject='Screen and feature comparison of two supplied project archives'
doc.core_properties.author='LIVE project review'
doc.save(OUT)
print(OUT)
