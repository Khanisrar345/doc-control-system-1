'use strict';
require('dotenv').config();

const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const mongoose   = require('mongoose');
const multer     = require('multer');
const moment     = require('moment');
const bcrypt     = require('bcrypt');
const XLSX       = require('xlsx');
const path       = require('path');
const fs         = require('fs');

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Copy .env.example to .env and configure it.');
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT || 3000;
const SALT = 10;

const uploadsDir = path.join(__dirname, 'public', 'uploads');
const logosDir   = path.join(uploadsDir, 'logos');
[uploadsDir, logosDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_me_in_production_dcs_enterprise_2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true }
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, (file.fieldname || '').includes('logo') ? logosDir : uploadsDir);
  },
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + String(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  }
});
const fileFilter = (req, file, cb) => {
  cb(null, /pdf|doc|docx|xls|xlsx|png|jpg|jpeg|dwg|zip|gif|webp/i.test(path.extname(file.originalname || '')));
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 25 * 1024 * 1024 } });
const uploadDocs  = upload.array('attachments', 20);
const uploadExcel = upload.single('excel_file');
const uploadLogo  = upload.fields([
  { name: 'company_logo', maxCount: 1 },
  { name: 'client_logo', maxCount: 1 },
  { name: 'consultant_logo', maxCount: 1 },
  { name: 'contractor_logo', maxCount: 1 },
  { name: 'project_logo', maxCount: 1 }
]);

const { Schema, model, Types } = mongoose;
const ROLES = ['super_admin', 'admin', 'document_controller', 'reviewer', 'viewer'];

const User = model('User', new Schema({
  full_name:  { type: String, required: true },
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:   { type: String, required: true },
  role:       { type: String, enum: ROLES, required: true },
  company:    String,
  phone:      String,
  active:     { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
}));

const Document = model('Document', new Schema({
  doc_number:    { type: String, required: true, unique: true },
  type:          { type: String, required: true },
  title:         { type: String, required: true },
  rev:           { type: String, default: 'A' },
  status:        { type: String, default: 'Open' },
  discipline:    String,
  area:          String,
  package:       String,
  contractor:    String,
  consultant:    String,
  originator:    String,
  reviewer:      String,
  approver:      String,
  submitted_by:  String,
  issue_date:    Date,
  due_date:      Date,
  response_date: Date,
  days_open:     { type: Number, default: 0 },
  remarks:       String,
  attachments:   [String],
  created_by:    { type: Types.ObjectId, ref: 'User' },
  updated_at:    { type: Date, default: Date.now }
}));

const Transmittal = model('Transmittal', new Schema({
  transmittal_no: { type: String, required: true, unique: true },
  title: String,
  issued_to: String,
  issued_by: { type: Types.ObjectId, ref: 'User' },
  documents: [{ type: Types.ObjectId, ref: 'Document' }],
  remarks: String,
  status: { type: String, enum: ['Draft', 'Issued', 'Acknowledged'], default: 'Draft' },
  created_at: { type: Date, default: Date.now }
}));

const Revision = model('Revision', new Schema({
  document_id: { type: Types.ObjectId, ref: 'Document', required: true },
  rev: String,
  changed_by: { type: Types.ObjectId, ref: 'User' },
  change_note: String,
  changed_at: { type: Date, default: Date.now }
}));

const Notification = model('Notification', new Schema({
  message: String,
  type: { type: String, default: 'all' },
  created_at: { type: Date, default: Date.now }
}));

const Branding = model('Branding', new Schema({
  company_logo: String,
  client_logo: String,
  consultant_logo: String,
  contractor_logo: String,
  project_logo: String,
  company_name:    { type: String, default: 'Document Control System' },
  project_name:    { type: String, default: 'Project Name' },
  project_number:  { type: String, default: '' },
  contract_number: { type: String, default: '' },
  client_name:     { type: String, default: '' },
  consultant_name: { type: String, default: '' },
  contractor_name: { type: String, default: '' },
  updated_at:      { type: Date, default: Date.now }
}));

function calcDaysOpen(issue_date, response_date) {
  if (!issue_date) return 0;
  return Math.max(0, moment(response_date || undefined).diff(moment(issue_date), 'days'));
}
function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
async function getBranding() {
  let b = await Branding.findOne();
  if (!b) b = await Branding.create({});
  return b;
}

async function initAdmin() {
  const exists = await User.findOne({ role: 'super_admin' });
  if (!exists) {
    const hash = await bcrypt.hash('ChangeMe@123', SALT);
    await User.create({
      full_name: 'Super Administrator',
      email: 'superadmin@dcs.local',
      password: hash,
      role: 'super_admin'
    });
    console.log('================================================');
    console.log('FIRST-TIME SUPER ADMIN (console only — not on UI)');
    console.log('Email:    superadmin@dcs.local');
    console.log('Password: ChangeMe@123');
    console.log('Change this password immediately after login.');
    console.log('================================================');
  }
  await getBranding();
  console.log('MongoDB connected | EDMS ready');
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.redirect('/app?page=dashboard&msg=' + encodeURIComponent('Access denied.'));
    }
    next();
  };
}

const canManageUsers = ['super_admin', 'admin'];
const canEditDocs    = ['super_admin', 'admin', 'document_controller'];
const canReview      = ['super_admin', 'admin', 'document_controller', 'reviewer'];

app.get('/', (req, res) => res.redirect(req.session.user ? '/app' : '/login'));

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/app?page=dashboard');
  res.render('login', { error: req.query.error || null });
});

app.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) {
      return res.redirect('/login?error=' + encodeURIComponent('Email and password required'));
    }
    const user = await User.findOne({ email, active: true });
    if (!user) return res.redirect('/login?error=' + encodeURIComponent('Invalid credentials'));
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.redirect('/login?error=' + encodeURIComponent('Invalid credentials'));
    req.session.user = {
      _id: user._id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      company: user.company || ''
    };
    res.redirect('/app?page=dashboard');
  } catch (e) {
    console.error(e);
    res.redirect('/login?error=' + encodeURIComponent('Login failed'));
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.post('/import-excel', requireAuth, requireRole(...canEditDocs), (req, res) => {
  uploadExcel(req, res, async (err) => {
    if (err || !req.file) return res.status(400).json({ error: 'Excel file required (.xlsx / .xls)' });
    try {
      const wb = XLSX.readFile(req.file.path);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      let imported = 0, skipped = 0;
      const errors = [];

      const pick = (row, keys) => {
        const map = {};
        Object.keys(row).forEach(k => {
          map[String(k).trim().toUpperCase().replace(/\s+/g, ' ')] = row[k];
        });
        for (const k of keys) {
          if (map[k] !== undefined && map[k] !== '') return map[k];
        }
        return '';
      };
      const parseDate = (v) => {
        if (!v && v !== 0) return null;
        if (typeof v === 'number') {
          const d = XLSX.SSF.parse_date_code(v);
          if (d) return new Date(d.y, d.m - 1, d.d);
        }
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      };

      for (const row of rows) {
        try {
          const doc_number = String(pick(row, ['DOC NUMBER', 'DOC NO', 'DOCUMENT NUMBER', 'DOC_NUMBER', 'NUMBER']) || '').trim();
          const type = String(pick(row, ['TYPE', 'DOC TYPE', 'DOCUMENT TYPE']) || '').trim();
          const title = String(pick(row, ['TITLE', 'DOCUMENT TITLE', 'DESCRIPTION']) || '').trim();
          if (!doc_number || !type || !title) { skipped++; continue; }

          const issue_date    = parseDate(pick(row, ['ISSUE DATE', 'ISSUED DATE', 'DATE ISSUED']));
          const due_date      = parseDate(pick(row, ['DUE DATE', 'RESPONSE DUE']));
          const response_date = parseDate(pick(row, ['RESPONSE DATE', 'CLOSED DATE']));

          await Document.updateOne(
            { doc_number },
            {
              $set: {
                doc_number, type, title,
                rev: String(pick(row, ['REV', 'REVISION', 'REV NO']) || 'A').trim(),
                status: String(pick(row, ['STATUS']) || 'Open').trim(),
                discipline: String(pick(row, ['DISCIPLINE', 'DISC']) || '').trim(),
                area: String(pick(row, ['AREA', 'ZONE', 'LOCATION']) || '').trim(),
                package: String(pick(row, ['PACKAGE', 'PKG']) || '').trim(),
                contractor: String(pick(row, ['CONTRACTOR', 'SUBCONTRACTOR']) || '').trim(),
                consultant: String(pick(row, ['CONSULTANT']) || '').trim(),
                originator: String(pick(row, ['ORIGINATOR', 'FROM']) || '').trim(),
                reviewer: String(pick(row, ['REVIEWER']) || '').trim(),
                approver: String(pick(row, ['APPROVER']) || '').trim(),
                submitted_by: String(pick(row, ['SUBMITTED BY', 'SUBMITTER']) || '').trim(),
                issue_date, due_date, response_date,
                days_open: calcDaysOpen(issue_date, response_date),
                remarks: String(pick(row, ['REMARKS', 'COMMENTS', 'NOTES']) || '').trim(),
                updated_at: new Date()
              }
            },
            { upsert: true }
          );
          imported++;
        } catch (e) {
          errors.push(e.message);
          skipped++;
        }
      }
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      res.json({ imported, skipped, errors: errors.slice(0, 20) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });
});

app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const today = startOfDay(new Date());
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const closedLike = ['Closed', 'Cancelled'];
    const approvedLike = [/approved/i];

    const total = await Document.countDocuments();
    const closed = await Document.countDocuments({ status: { $in: closedLike } });
    const approved = await Document.countDocuments({ status: { $regex: /approved/i } });
    const rejected = await Document.countDocuments({ status: { $regex: /reject/i } });
    const overdue = await Document.countDocuments({
      due_date: { $lt: today },
      status: { $nin: ['Approved', 'Closed', 'Cancelled', 'Approved with Comments'] }
    });
    const pending = await Document.countDocuments({
      status: { $in: ['Pending', 'Under Review', 'Submitted', 'Open'] }
    });
    const statusAgg = await Document.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const typeAgg = await Document.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]);
    const discAgg = await Document.aggregate([{ $group: { _id: '$discipline', count: { $sum: 1 } } }]);
    const monthly = await Document.aggregate([
      { $match: { issue_date: { $ne: null } } },
      { $group: { _id: { y: { $year: '$issue_date' }, m: { $month: '$issue_date' } }, count: { $sum: 1 } } },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
      { $limit: 12 }
    ]);
    const discType = await Document.aggregate([
      { $group: { _id: { type: '$type', discipline: '$discipline', status: '$status' }, count: { $sum: 1 } } }
    ]);

    const by_status = {}, by_type = {}, by_discipline = {};
    statusAgg.forEach(s => { by_status[s._id || 'Unknown'] = s.count; });
    typeAgg.forEach(t => { by_type[t._id || 'Unknown'] = t.count; });
    discAgg.forEach(d => { by_discipline[d._id || 'General'] = d.count; });

    const discipline_analysis = {};
    discType.forEach(r => {
      const t = r._id.type || 'Other';
      const d = r._id.discipline || 'General';
      const s = r._id.status || 'Open';
      if (!discipline_analysis[t]) discipline_analysis[t] = {};
      if (!discipline_analysis[t][d]) discipline_analysis[t][d] = { Total: 0 };
      discipline_analysis[t][d][s] = (discipline_analysis[t][d][s] || 0) + r.count;
      discipline_analysis[t][d].Total += r.count;
    });

    res.json({
      total_documents: total,
      active_documents: total - closed,
      closed_documents: closed,
      approved_documents: approved,
      rejected_documents: rejected,
      overdue_documents: overdue,
      pending_documents: pending,
      submitted_today: await Document.countDocuments({ issue_date: { $gte: today } }),
      submitted_week: await Document.countDocuments({ issue_date: { $gte: weekAgo } }),
      submitted_month: await Document.countDocuments({ issue_date: { $gte: monthStart } }),
      by_status, by_type, by_discipline, discipline_analysis,
      monthly_trend: monthly.map(m => ({
        label: `${m._id.y}-${String(m._id.m).padStart(2, '0')}`,
        count: m.count
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function appHandler(req, res) {
  try {
    const page = req.query.page || 'dashboard';
    const user = req.session.user;
    let success_msg = req.query.msg || null;
    const branding = await getBranding();

    if (req.query.delete && req.query.table && req.query.id) {
      const { table, id } = req.query;
      if (table === 'documents' && canEditDocs.includes(user.role)) await Document.findByIdAndDelete(id);
      else if (table === 'transmittals' && canEditDocs.includes(user.role)) await Transmittal.findByIdAndDelete(id);
      else if (table === 'users' && canManageUsers.includes(user.role)) {
        if (id === String(user._id)) {
          return res.redirect('/app?page=manage_users&msg=' + encodeURIComponent('Cannot delete your own account.'));
        }
        const target = await User.findById(id);
        if (target && target.role === 'super_admin' && user.role !== 'super_admin') {
          return res.redirect('/app?page=manage_users&msg=' + encodeURIComponent('Only Super Admin can delete Super Admin.'));
        }
        await User.findByIdAndDelete(id);
      } else if (table === 'notifications' && canManageUsers.includes(user.role)) {
        await Notification.findByIdAndDelete(id);
      }
      return res.redirect(`/app?page=${req.query.page || page}&msg=` + encodeURIComponent('Record deleted.'));
    }

    if (req.method === 'POST') {
      const action = req.body.action;

      if (action === 'add_document' && canEditDocs.includes(user.role)) {
        let doc_number = String(req.body.doc_number || '').trim();
        if (!doc_number) {
          const t = String(req.body.type || 'DOC').toUpperCase();
          const d = String(req.body.discipline || 'GEN').toUpperCase();
          const c = await Document.countDocuments({ type: t, discipline: d });
          doc_number = `${t}-${d}-${String(c + 1).padStart(3, '0')}`;
        }
        const issue = req.body.issue_date ? new Date(req.body.issue_date) : null;
        const due = req.body.due_date ? new Date(req.body.due_date) : null;
        const resp = req.body.response_date ? new Date(req.body.response_date) : null;
        const files = req.files ? req.files.map(f => f.filename) : [];
        const doc = await Document.create({
          doc_number,
          type: req.body.type,
          title: req.body.title,
          rev: req.body.rev || 'A',
          status: req.body.status || 'Open',
          discipline: req.body.discipline,
          area: req.body.area,
          package: req.body.package,
          contractor: req.body.contractor,
          consultant: req.body.consultant,
          originator: req.body.originator,
          reviewer: req.body.reviewer,
          approver: req.body.approver,
          submitted_by: req.body.submitted_by,
          issue_date: issue, due_date: due, response_date: resp,
          days_open: calcDaysOpen(issue, resp),
          remarks: req.body.remarks,
          attachments: files,
          created_by: user._id
        });
        await Revision.create({ document_id: doc._id, rev: doc.rev, changed_by: user._id, change_note: 'Initial submission' });
        success_msg = 'Document added.';
      }

      else if (action === 'update_document' && canEditDocs.includes(user.role)) {
        const old = await Document.findById(req.body.id);
        const issue = req.body.issue_date ? new Date(req.body.issue_date) : null;
        const due = req.body.due_date ? new Date(req.body.due_date) : null;
        const resp = req.body.response_date ? new Date(req.body.response_date) : null;
        const files = req.files ? req.files.map(f => f.filename) : [];
        const newAtts = old ? [...(old.attachments || []), ...files] : files;
        await Document.findByIdAndUpdate(req.body.id, {
          type: req.body.type, title: req.body.title, rev: req.body.rev, status: req.body.status,
          discipline: req.body.discipline, area: req.body.area, package: req.body.package,
          contractor: req.body.contractor, consultant: req.body.consultant,
          originator: req.body.originator, reviewer: req.body.reviewer, approver: req.body.approver,
          submitted_by: req.body.submitted_by,
          issue_date: issue, due_date: due, response_date: resp,
          days_open: calcDaysOpen(issue, resp), remarks: req.body.remarks,
          attachments: newAtts, updated_at: new Date()
        });
        if (old && old.rev !== req.body.rev) {
          await Revision.create({
            document_id: req.body.id, rev: req.body.rev, changed_by: user._id,
            change_note: req.body.change_note || 'Revision update'
          });
        }
        success_msg = 'Document updated.';
      }

      else if (action === 'update_status' && canReview.includes(user.role)) {
        const resp = req.body.response_date ? new Date(req.body.response_date) : null;
        const doc = await Document.findById(req.body.id);
        await Document.findByIdAndUpdate(req.body.id, {
          status: req.body.status,
          response_date: resp,
          remarks: req.body.remarks,
          days_open: calcDaysOpen(doc ? doc.issue_date : null, resp),
          updated_at: new Date()
        });
        success_msg = 'Status updated.';
      }

      else if (action === 'add_user' && canManageUsers.includes(user.role)) {
        const role = req.body.role;
        if (role === 'super_admin' && user.role !== 'super_admin') {
          success_msg = 'Only Super Admin can create Super Admin.';
        } else {
          const hash = await bcrypt.hash(req.body.password || 'ChangeMe@123', SALT);
          await User.create({
            full_name: req.body.full_name,
            email: String(req.body.email || '').trim().toLowerCase(),
            password: hash,
            role,
            company: req.body.company,
            phone: req.body.phone
          });
          success_msg = 'User created.';
        }
      }

      else if (action === 'update_user' && canManageUsers.includes(user.role)) {
        const updates = {
          full_name: req.body.full_name,
          email: String(req.body.email || '').trim().toLowerCase(),
          company: req.body.company,
          phone: req.body.phone
        };
        if (req.body.role) {
          if (req.body.role === 'super_admin' && user.role !== 'super_admin') {
            /* ignore */
          } else updates.role = req.body.role;
        }
        await User.findByIdAndUpdate(req.body.id, updates);
        success_msg = 'User updated.';
      }

      else if (action === 'reset_password' && canManageUsers.includes(user.role)) {
        const newPass = req.body.new_password || '';
        if (newPass.length < 6) success_msg = 'Password must be at least 6 characters.';
        else {
          await User.findByIdAndUpdate(req.body.id, { password: await bcrypt.hash(newPass, SALT) });
          success_msg = 'Password reset successfully.';
        }
      }

      else if (action === 'change_own_password') {
        const u = await User.findById(user._id);
        const ok = await bcrypt.compare(req.body.current_password || '', u.password);
        if (!ok) success_msg = 'Current password incorrect.';
        else if ((req.body.new_password || '').length < 6) success_msg = 'New password too short.';
        else {
          u.password = await bcrypt.hash(req.body.new_password, SALT);
          await u.save();
          success_msg = 'Your password was changed.';
        }
      }

      else if (action === 'update_branding' && canManageUsers.includes(user.role)) {
        const b = await getBranding();
        ['company_name', 'project_name', 'project_number', 'contract_number', 'client_name', 'consultant_name', 'contractor_name']
          .forEach(f => { if (req.body[f] !== undefined) b[f] = req.body[f]; });
        if (req.files) {
          ['company_logo', 'client_logo', 'consultant_logo', 'contractor_logo', 'project_logo'].forEach(key => {
            if (req.files[key] && req.files[key][0]) b[key] = 'logos/' + req.files[key][0].filename;
          });
        }
        b.updated_at = new Date();
        await b.save();
        success_msg = 'Branding saved.';
      }

      else if (action === 'create_transmittal' && canEditDocs.includes(user.role)) {
        const year = new Date().getFullYear();
        const count = await Transmittal.countDocuments();
        const doc_ids = req.body.document_ids
          ? (Array.isArray(req.body.document_ids) ? req.body.document_ids : [req.body.document_ids])
          : [];
        await Transmittal.create({
          transmittal_no: `TRN-${year}-${String(count + 1).padStart(3, '0')}`,
          title: req.body.title,
          issued_to: req.body.issued_to,
          issued_by: user._id,
          documents: doc_ids,
          remarks: req.body.remarks,
          status: 'Draft'
        });
        success_msg = 'Transmittal created.';
      }

      else if (action === 'issue_transmittal' && canEditDocs.includes(user.role)) {
        await Transmittal.findByIdAndUpdate(req.body.id, { status: 'Issued' });
        success_msg = 'Transmittal issued.';
      }

      else if (action === 'acknowledge_transmittal' && canReview.includes(user.role)) {
        await Transmittal.findByIdAndUpdate(req.body.id, { status: 'Acknowledged' });
        success_msg = 'Transmittal acknowledged.';
      }

      else if (action === 'send_notification' && canManageUsers.includes(user.role)) {
        await Notification.create({ message: req.body.message, type: req.body.type || 'all' });
        success_msg = 'Notification sent.';
      }

      return res.redirect(`/app?page=${page}&msg=` + encodeURIComponent(success_msg || 'Done'));
    }

    const data = {
      user, page, success_msg, branding, ROLES,
      documents: [], transmittals: [], users: [], notifications: [], notifs: [],
      revisions: [], overdue_docs: [], doc: null, top_pending: [],
      f_type: req.query.type || '', f_discipline: req.query.discipline || '',
      f_status: req.query.status || '', f_contractor: req.query.contractor || '',
      f_area: req.query.area || '', f_search: req.query.search || '',
      f_package: req.query.package || '', f_from: req.query.from || '', f_to: req.query.to || '',
      total_documents: 0, total_transmittals: 0, total_users: 0,
      overdue_count: 0, approved_count: 0, rejected_count: 0,
      review_count: 0, pending_count: 0, closed_count: 0, active_count: 0,
      today_count: 0, week_count: 0, month_count: 0, approval_rate: 0,
      by_status: {}, by_type: {}, by_discipline: {},
      recent_docs: [], recent_transmittals: [],
      canEditDocs: canEditDocs.includes(user.role),
      canManageUsers: canManageUsers.includes(user.role),
      canReview: canReview.includes(user.role)
    };

    data.doc_types   = (await Document.distinct('type')).filter(Boolean).sort();
    data.disciplines = (await Document.distinct('discipline')).filter(Boolean).sort();
    data.statuses    = (await Document.distinct('status')).filter(Boolean).sort();
    data.contractors = (await Document.distinct('contractor')).filter(Boolean).sort();
    data.areas       = (await Document.distinct('area')).filter(Boolean).sort();
    data.packages    = (await Document.distinct('package')).filter(Boolean).sort();

    if (['dashboard', 'reports', 'weekly_summary'].includes(page)) {
      const today = startOfDay(new Date());
      const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      data.total_documents = await Document.countDocuments();
      data.total_transmittals = await Transmittal.countDocuments();
      data.total_users = await User.countDocuments();
      data.closed_count = await Document.countDocuments({ status: { $in: ['Closed', 'Cancelled'] } });
      data.active_count = data.total_documents - data.closed_count;
      data.approved_count = await Document.countDocuments({ status: { $regex: /approved/i } });
      data.rejected_count = await Document.countDocuments({ status: { $regex: /reject/i } });
      data.review_count = await Document.countDocuments({ status: 'Under Review' });
      data.pending_count = await Document.countDocuments({ status: { $in: ['Pending', 'Open', 'Submitted', 'Under Review'] } });
      data.overdue_count = await Document.countDocuments({
        due_date: { $lt: today },
        status: { $nin: ['Approved', 'Closed', 'Cancelled', 'Approved with Comments'] }
      });
      data.today_count = await Document.countDocuments({ issue_date: { $gte: today } });
      data.week_count = await Document.countDocuments({ issue_date: { $gte: weekAgo } });
      data.month_count = await Document.countDocuments({ issue_date: { $gte: monthStart } });
      data.approval_rate = data.total_documents ? Math.round(data.approved_count / data.total_documents * 100) : 0;
      (await Document.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])).forEach(s => { data.by_status[s._id] = s.count; });
      (await Document.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }])).forEach(t => { data.by_type[t._id] = t.count; });
      (await Document.aggregate([{ $group: { _id: '$discipline', count: { $sum: 1 } } }])).forEach(d => { data.by_discipline[d._id || 'General'] = d.count; });
      data.recent_docs = await Document.find().sort({ updated_at: -1 }).limit(10);
      data.recent_transmittals = await Transmittal.find().sort({ created_at: -1 }).limit(5).populate('issued_by');
      data.overdue_docs = await Document.find({
        due_date: { $lt: today },
        status: { $nin: ['Approved', 'Closed', 'Cancelled', 'Approved with Comments'] }
      }).sort({ days_open: -1 }).limit(50);
      data.top_pending = await Document.find({
        status: { $in: ['Pending', 'Under Review', 'Open', 'Submitted'] }
      }).sort({ days_open: -1 }).limit(10);
    }

    if (page === 'document_register' || page === 'my_submissions') {
      const filter = {};
      if (req.query.type) filter.type = req.query.type;
      if (req.query.discipline) filter.discipline = req.query.discipline;
      if (req.query.status) filter.status = req.query.status;
      if (req.query.contractor) filter.contractor = req.query.contractor;
      if (req.query.area) filter.area = req.query.area;
      if (req.query.package) filter.package = req.query.package;
      if (req.query.from || req.query.to) {
        filter.issue_date = {};
        if (req.query.from) filter.issue_date.$gte = new Date(req.query.from);
        if (req.query.to) filter.issue_date.$lte = new Date(req.query.to);
      }
      if (req.query.search) {
        filter.$or = [
          { doc_number: new RegExp(req.query.search, 'i') },
          { title: new RegExp(req.query.search, 'i') },
          { contractor: new RegExp(req.query.search, 'i') }
        ];
      }
      data.documents = await Document.find(filter).sort({ updated_at: -1 }).limit(5000);
    }

    if (page === 'edit_document' && req.query.id) data.doc = await Document.findById(req.query.id);
    if (page === 'transmittals') {
      data.transmittals = await Transmittal.find().populate('issued_by documents').sort({ created_at: -1 });
    }
    if (page === 'create_transmittal') {
      data.documents = await Document.find({ status: { $nin: ['Approved', 'Closed'] } }).sort({ updated_at: -1 }).limit(500);
    }
    if (page === 'revisions') {
      data.revisions = await Revision.find().populate('document_id changed_by').sort({ changed_at: -1 }).limit(100);
    }
    if (page === 'manage_users' && canManageUsers.includes(user.role)) {
      data.users = await User.find().sort({ role: 1, full_name: 1 });
    }
    if (page === 'notifications' && canManageUsers.includes(user.role)) {
      data.notifications = await Notification.find().sort({ created_at: -1 });
    }
    if (page === 'my_notifications') {
      data.notifs = await Notification.find({ type: { $in: [user.role, 'all'] } }).sort({ created_at: -1 });
    }
    if (page === 'reports') {
      data.documents = await Document.find().sort({ updated_at: -1 }).limit(10000);
    }

    res.render('app', data);
  } catch (err) {
    console.error('appHandler error:', err);
    res.status(500).send('Error: ' + err.message);
  }
}

app.get('/app', requireAuth, appHandler);
app.post('/app', requireAuth, (req, res, next) => {
  if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    if ((req.query.page || '') === 'branding') {
      return uploadLogo(req, res, (err) => { if (err) console.error(err); next(); });
    }
    return uploadDocs(req, res, (err) => { if (err) console.error(err); next(); });
  }
  next();
}, appHandler);

app.use((req, res) => res.status(404).send(`Not found: ${req.method} ${req.url}`));

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    await initAdmin();
    app.listen(PORT, '0.0.0.0', () => console.log(`EDMS running on port ${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB failed:', err.message);
    process.exit(1);
  });