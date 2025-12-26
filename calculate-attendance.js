#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    
    // Check for help flag
    if (args.includes('-h') || args.includes('--help')) {
        console.log(`
Использование: node calculate-attendance.js [OPTIONS]

Опции:
  -s, --source <путь>    Путь к папке с исходными данными
                         По умолчанию: ./source_data
  -o, --output <путь>    Путь к папке для выходных файлов
                         По умолчанию: ./output
  -h, --help             Показать эту справку

Примеры:
  node calculate-attendance.js
  node calculate-attendance.js --source ./my_data
  node calculate-attendance.js -s ./data -o ./reports
`);
        process.exit(0);
    }
    
    let sourceDir = path.join(__dirname, 'source_data');
    let outputDir = path.join(__dirname, 'output');
    
    // Parse arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-s' || args[i] === '--source') {
            if (i + 1 < args.length) {
                sourceDir = path.isAbsolute(args[i + 1]) 
                    ? args[i + 1] 
                    : path.join(__dirname, args[i + 1]);
                i++;
            }
        } else if (args[i] === '-o' || args[i] === '--output') {
            if (i + 1 < args.length) {
                outputDir = path.isAbsolute(args[i + 1]) 
                    ? args[i + 1] 
                    : path.join(__dirname, args[i + 1]);
                i++;
            }
        }
    }
    
    return { sourceDir, outputDir };
}

const config = parseArgs();

// Configuration
const SOURCE_DIR = config.sourceDir;
const OUTPUT_DIR = config.outputDir;
const ATTENDANCE_FILE = 'attendance_journal.txt';
const STUDENTS_FILE = 'students_list.txt';

// Attendance markers
const ABSENCE_MARKER_ID = '110000148';  // point1Id value when student was absent

/**
 * Read and parse a JSON file
 */
function readJsonFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Load student names from students_list.txt
 */
function loadStudentNames() {
    const filePath = path.join(SOURCE_DIR, STUDENTS_FILE);
    const data = readJsonFile(filePath);
    
    if (!data || !data.tbl || !Array.isArray(data.tbl)) {
        console.error('Invalid students list format');
        return new Map();
    }
    
    const studentNames = new Map();
    for (const table of data.tbl) {
        if (table.r && Array.isArray(table.r)) {
            for (const record of table.r) {
                if (record.studentId && record.personFullname) {
                    studentNames.set(record.studentId, record.personFullname);
                }
            }
        }
    }
    
    console.log(`Загружено ${studentNames.size} уникальных имен студентов`);
    return studentNames;
}

/**
 * Load all course meetings from the source directory
 */
function loadCourseMeetings() {
    const meetings = new Map();
    const files = fs.readdirSync(SOURCE_DIR);
    
    // Filter meeting files (exclude attendance journal)
    const meetingFiles = files.filter(f => 
        f.endsWith('.txt') && f !== ATTENDANCE_FILE
    );
    
    console.log(`Загрузка ${meetingFiles.length} файлов занятий...`);
    
    for (const file of meetingFiles) {
        const filePath = path.join(SOURCE_DIR, file);
        const data = readJsonFile(filePath);
        
        if (data && data.tbl && Array.isArray(data.tbl)) {
            for (const table of data.tbl) {
                if (table.r && Array.isArray(table.r)) {
                    for (const meeting of table.r) {
                        meetings.set(meeting.id, {
                            id: meeting.id,
                            courseId: meeting.courseId,
                            meetingDate: meeting.meetingDate,
                            lessonType: meeting.lessonType || meeting.lessonTypeEn,
                            code: meeting.code,
                            startTime: meeting.startTime,
                            endTime: meeting.endTime,
                            teacherId: meeting.teacherId
                        });
                    }
                }
            }
        }
    }
    
    console.log(`Загружено ${meetings.size} занятий`);
    return meetings;
}

/**
 * Load attendance records from the journal
 */
function loadAttendanceRecords() {
    const filePath = path.join(SOURCE_DIR, ATTENDANCE_FILE);
    const data = readJsonFile(filePath);
    
    if (!data || !data.tbl || !Array.isArray(data.tbl)) {
        console.error('Invalid attendance journal format');
        return [];
    }
    
    const records = [];
    for (const table of data.tbl) {
        if (table.r && Array.isArray(table.r)) {
            records.push(...table.r);
        }
    }
    
    console.log(`Загружено ${records.length} записей о посещаемости`);
    return records;
}

/**
 * Build attendance matrix: student -> meeting -> status
 */
function buildAttendanceMatrix(attendanceRecords, meetings) {
    // Map of studentId -> Map of meetingId -> attendance status
    const attendanceMatrix = new Map();
    
    // Set of all unique meeting IDs we have records for
    const allMeetingIds = new Set();
    
    for (const record of attendanceRecords) {
        const studentId = record.studentId;
        const meetingId = record.courseMeetingId;
        const point1Id = record.point1Id;
        
        allMeetingIds.add(meetingId);
        
        if (!attendanceMatrix.has(studentId)) {
            attendanceMatrix.set(studentId, new Map());
        }
        
        const studentMeetings = attendanceMatrix.get(studentId);
        
        // Determine attendance status
        const status = point1Id === ABSENCE_MARKER_ID ? 'absent' : 'attended';
        studentMeetings.set(meetingId, status);
    }
    
    // Get all meetings sorted by date
    const sortedMeetings = Array.from(allMeetingIds)
        .map(id => meetings.get(id) || { id, meetingDate: '9999-99-99' })
        .sort((a, b) => {
            const dateA = a.meetingDate || '9999-99-99';
            const dateB = b.meetingDate || '9999-99-99';
            if (dateA !== dateB) return dateA.localeCompare(dateB);
            return (a.startTime || '').localeCompare(b.startTime || '');
        });
    
    // Calculate summary stats for each student
    const studentStats = new Map();
    for (const [studentId, meetingsMap] of attendanceMatrix) {
        let attended = 0;
        let absent = 0;
        
        for (const status of meetingsMap.values()) {
            if (status === 'attended') attended++;
            else if (status === 'absent') absent++;
        }
        
        const total = attended + absent;
        const ratio = total > 0 ? (attended / total * 100).toFixed(2) : '0.00';
        
        studentStats.set(studentId, {
            studentId,
            attended,
            absent,
            total,
            attendanceRatio: ratio
        });
    }
    
    return {
        attendanceMatrix,
        sortedMeetings,
        studentStats
    };
}

/**
 * Generate HTML table report
 */
function generateHtmlReport(attendanceMatrix, sortedMeetings, studentStats, studentNames) {
    // Get all students and sort by name
    const students = Array.from(studentStats.values())
        .map(stats => ({
            ...stats,
            name: studentNames.get(stats.studentId) || `Unknown (${stats.studentId})`
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    
    // Calculate summary statistics
    const totalRecords = students.reduce((sum, s) => sum + s.total, 0);
    const avgAttendance = students.length > 0 
        ? (students.reduce((sum, s) => sum + parseFloat(s.attendanceRatio), 0) / students.length).toFixed(2)
        : '0.00';
    
    // Generate table header with meetings
    let tableHeader = `
        <thead>
            <tr>
                <th class="sticky-col student-name-header">Имя студента</th>
                <th class="stats-col">Присутствовал</th>
                <th class="stats-col">Пропущено</th>
                <th class="stats-col">Всего</th>
                <th class="stats-col">Посещаемость %</th>`;
    
    for (const meeting of sortedMeetings) {
        const date = meeting.meetingDate || 'Unknown';
        const time = meeting.startTime || '';
        const type = meeting.lessonTypeCode || meeting.lessonType || 'Class';
        tableHeader += `
                <th class="meeting-col" title="${date} ${time} - ${meeting.lessonType || 'Class'}">
                    <div class="meeting-header">
                        <div class="meeting-date">${date}</div>
                        <div class="meeting-type">${type}</div>
                    </div>
                </th>`;
    }
    
    tableHeader += `
            </tr>
        </thead>`;
    
    // Generate table body with student rows
    let tableBody = '<tbody>';
    for (const student of students) {
        const studentMeetings = attendanceMatrix.get(student.studentId) || new Map();
        const ratioClass = getRatioClass(parseFloat(student.attendanceRatio));
        
        tableBody += `
            <tr>
                <td class="sticky-col student-name">${student.name}</td>
                <td class="stats-col attended-count">${student.attended}</td>
                <td class="stats-col absent-count">${student.absent}</td>
                <td class="stats-col total-count">${student.total}</td>
                <td class="stats-col attendance-ratio ${ratioClass}">${student.attendanceRatio}%</td>`;
        
        for (const meeting of sortedMeetings) {
            const status = studentMeetings.get(meeting.id);
            let cellClass = 'attendance-cell';
            let cellContent = '—';
            
            if (status === 'attended') {
                cellClass += ' attended';
                cellContent = '✓';
            } else if (status === 'absent') {
                cellClass += ' absent';
                cellContent = '✗';
            } else {
                cellClass += ' not-required';
                cellContent = '—';
            }
            
            tableBody += `<td class="${cellClass}">${cellContent}</td>`;
        }
        
        tableBody += '</tr>';
    }
    tableBody += '</tbody>';
    
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Отчет о посещаемости студентов</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="container">
        <header class="no-print">
            <h1>📊 Отчет о посещаемости студентов</h1>
            <div class="summary">
                <div class="summary-card">
                    <div class="summary-value">${students.length}</div>
                    <div class="summary-label">Всего студентов</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">${totalRecords}</div>
                    <div class="summary-label">Всего записей</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">${sortedMeetings.length}</div>
                    <div class="summary-label">Всего занятий</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value">${avgAttendance}%</div>
                    <div class="summary-label">Средняя посещаемость</div>
                </div>
            </div>
        </header>

        <div class="controls no-print">
            <input type="text" id="searchBox" placeholder="🔍 Поиск по имени студента..." />
            <div class="legend">
                <span class="legend-item"><span class="legend-symbol attended">✓</span> Присутствовал</span>
                <span class="legend-item"><span class="legend-symbol absent">✗</span> Отсутствовал</span>
                <span class="legend-item"><span class="legend-symbol not-required">—</span> Не требуется</span>
            </div>
            <button id="printButton" class="print-button" onclick="printReport()">
                🖨️ Печать отчета
            </button>
        </div>

        <div class="table-container no-print">
            <table id="attendanceTable">
                ${tableHeader}
                ${tableBody}
            </table>
        </div>

        <!-- Print-only summary view -->
        <div class="print-only print-summary">
            <h1 class="print-title">Отчет о посещаемости студентов</h1>
            <table class="print-summary-table">
                <thead>
                    <tr>
                        <th class="print-col-number">№</th>
                        <th class="print-col-name">Имя студента</th>
                        <th class="print-col-stat">Всего занятий</th>
                        <th class="print-col-stat">Присутствовал</th>
                        <th class="print-col-stat">Пропущено</th>
                        <th class="print-col-stat">Посещаемость %</th>
                    </tr>
                </thead>
                <tbody>
                    ${students.map((student, index) => `
                    <tr>
                        <td class="print-col-number">${index + 1}</td>
                        <td class="print-col-name">${student.name}</td>
                        <td class="print-col-stat">${student.total}</td>
                        <td class="print-col-stat attended">${student.attended}</td>
                        <td class="print-col-stat absent">${student.absent}</td>
                        <td class="print-col-stat attendance-ratio ${getRatioClass(parseFloat(student.attendanceRatio))}">${student.attendanceRatio}%</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>
    <script src="script.js"></script>
</body>
</html>`;
    
    return html;
}

/**
 * Get CSS class based on attendance ratio
 */
function getRatioClass(ratio) {
    if (ratio >= 80) return 'excellent';
    if (ratio >= 60) return 'good';
    if (ratio >= 40) return 'warning';
    return 'poor';
}

/**
 * Generate CSS styles
 */
function generateCss() {
    return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    padding: 20px;
    color: #333;
}

.container {
    max-width: 100%;
    margin: 0 auto;
    padding: 0 10px;
}

header {
    background: white;
    border-radius: 16px;
    padding: 30px;
    margin-bottom: 30px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
}

header h1 {
    font-size: 2.5rem;
    margin-bottom: 20px;
    color: #667eea;
    text-align: center;
}

.summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 15px;
    margin-top: 20px;
}

.summary-card {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 20px;
    border-radius: 12px;
    text-align: center;
    color: white;
}

.summary-value {
    font-size: 2.5rem;
    font-weight: bold;
    margin-bottom: 5px;
}

.summary-label {
    font-size: 0.9rem;
    opacity: 0.9;
}

.controls {
    display: flex;
    gap: 15px;
    margin-bottom: 20px;
    flex-wrap: wrap;
    align-items: center;
}

#searchBox {
    flex: 1;
    min-width: 250px;
    padding: 12px 20px;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.legend {
    display: flex;
    gap: 20px;
    background: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
}

.legend-symbol {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    font-weight: bold;
    font-size: 1.1rem;
}

.legend-symbol.attended {
    background: #d4edda;
    color: #155724;
}

.legend-symbol.absent {
    background: #f8d7da;
    color: #721c24;
}

.legend-symbol.not-required {
    background: #f0f0f0;
    color: #666;
}

.print-button {
    padding: 12px 24px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s, box-shadow 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
}

.print-button:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
}

.print-button:active {
    transform: translateY(0);
}

.table-container {
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    overflow-x: auto;
    overflow-y: auto;
    max-height: 80vh;
}

#attendanceTable {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.9rem;
}

#attendanceTable thead {
    position: sticky;
    top: 0;
    z-index: 10;
    background: white;
}

#attendanceTable th {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 12px 8px;
    text-align: center;
    font-weight: 600;
    border: 1px solid rgba(255, 255, 255, 0.2);
}

.sticky-col {
    position: sticky;
    left: 0;
    z-index: 5;
    background: white;
}

#attendanceTable thead .sticky-col {
    z-index: 15;
}

.student-name-header {
    min-width: 200px;
    max-width: 250px;
    text-align: left !important;
    padding-left: 16px !important;
}

.student-name {
    min-width: 200px;
    max-width: 250px;
    font-weight: 500;
    padding: 12px 16px;
    text-align: left;
    border-right: 2px solid #e0e0e0;
    background: white;
}

.stats-col {
    min-width: 80px;
    font-weight: 600;
}

.meeting-col {
    min-width: 100px;
    max-width: 120px;
}

.meeting-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.meeting-date {
    font-size: 0.85rem;
    font-weight: 600;
}

.meeting-type {
    font-size: 0.75rem;
    opacity: 0.9;
}

#attendanceTable tbody tr {
    transition: background-color 0.2s;
}

#attendanceTable tbody tr:nth-child(even) {
    background: #f8f9fa;
}

#attendanceTable tbody tr:hover {
    background: #e3f2fd;
}

#attendanceTable td {
    padding: 12px 8px;
    text-align: center;
    border: 1px solid #e0e0e0;
}

.attendance-cell {
    font-size: 1.2rem;
    font-weight: bold;
}

.attendance-cell.attended {
    background: #d4edda;
    color: #155724;
}

.attendance-cell.absent {
    background: #f8d7da;
    color: #721c24;
}

.attendance-cell.not-required {
    background: #f0f0f0;
    color: #999;
}

.attended-count {
    color: #155724;
    background: #d4edda;
}

.absent-count {
    color: #721c24;
    background: #f8d7da;
}

.total-count {
    color: #004085;
    background: #cce5ff;
}

.attendance-ratio {
    font-weight: bold;
}

.attendance-ratio.excellent {
    background: #d4edda;
    color: #155724;
}

.attendance-ratio.good {
    background: #d1ecf1;
    color: #0c5460;
}

.attendance-ratio.warning {
    background: #fff3cd;
    color: #856404;
}

.attendance-ratio.poor {
    background: #f8d7da;
    color: #721c24;
}

@media (max-width: 768px) {
    header h1 {
        font-size: 1.8rem;
    }
    
    .summary {
        grid-template-columns: 1fr 1fr;
    }
    
    .controls {
        flex-direction: column;
    }
    
    #searchBox {
        width: 100%;
    }
    
    .legend {
        width: 100%;
        justify-content: space-around;
    }
    
    .student-name-header,
    .student-name {
        min-width: 150px;
        max-width: 150px;
    }
    
    #attendanceTable {
        font-size: 0.8rem;
    }
    
    #attendanceTable th,
    #attendanceTable td {
        padding: 8px 4px;
    }
}

.print-only {
    display: none;
}

@media print {
    body {
        background: white;
        padding: 10px;
        color: black;
    }
    
    .no-print {
        display: none !important;
    }
    
    .print-only {
        display: block !important;
    }
    
    .table-container {
        display: none !important;
    }
    
    /* Print summary styles */
    .print-summary {
        width: 100%;
    }
    
    .print-title {
        text-align: center;
        margin-bottom: 15px;
        font-size: 1.3rem;
        color: #333;
        border-bottom: 2px solid #667eea;
        padding-bottom: 8px;
    }
    
    .print-summary-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
        font-size: 0.9rem;
    }
    
    .print-summary-table thead {
        background: #667eea !important;
        color: white !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    
    .print-summary-table th {
        padding: 12px 8px;
        text-align: left;
        font-weight: 600;
        border: 1px solid #555;
    }
    
    .print-summary-table td {
        padding: 10px 8px;
        border: 1px solid #ddd;
    }
    
    .print-summary-table tbody tr:nth-child(even) {
        background: #f8f9fa !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    
    .print-col-number {
        width: 40px;
        text-align: center !important;
    }
    
    .print-col-name {
        min-width: 200px;
        font-weight: 500;
    }
    
    .print-col-stat {
        text-align: center !important;
        width: 100px;
    }
    
    .print-summary-table .attended {
        background: #d4edda !important;
        color: #155724 !important;
        font-weight: bold;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    
    .print-summary-table .absent {
        background: #f8d7da !important;
        color: #721c24 !important;
        font-weight: bold;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    
    .print-summary-table .attendance-ratio {
        font-weight: bold;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    
    .print-summary-table .attendance-ratio.excellent {
        background: #d4edda !important;
        color: #155724 !important;
    }
    
    .print-summary-table .attendance-ratio.good {
        background: #d1ecf1 !important;
        color: #0c5460 !important;
    }
    
    .print-summary-table .attendance-ratio.warning {
        background: #fff3cd !important;
        color: #856404 !important;
    }
    
    .print-summary-table .attendance-ratio.poor {
        background: #f8d7da !important;
        color: #721c24 !important;
    }
}`;
}

/**
 * Generate JavaScript for interactivity
 */
function generateJs() {
    return `// Search functionality for table
const searchBox = document.getElementById('searchBox');
const table = document.getElementById('attendanceTable');
const rows = Array.from(table.querySelectorAll('tbody tr'));

searchBox.addEventListener('input', function() {
    const searchTerm = searchBox.value.toLowerCase();
    
    rows.forEach(row => {
        const studentName = row.querySelector('.student-name').textContent.toLowerCase();
        const matches = studentName.includes(searchTerm);
        row.style.display = matches ? '' : 'none';
    });
});

// Add click to highlight row
rows.forEach(row => {
    row.addEventListener('click', function() {
        rows.forEach(r => r.classList.remove('highlighted'));
        this.classList.add('highlighted');
    });
});

// Print functionality
function printReport() {
    // Clear any search filters before printing
    searchBox.value = '';
    rows.forEach(row => {
        row.style.display = '';
    });
    
    // Trigger browser print dialog
    window.print();
}`;
}

/**
 * Main function
 */
function main() {
    console.log('🎓 Калькулятор посещаемости студентов');
    console.log('=====================================\n');
    
    // Check if source directory exists
    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`❌ Ошибка: Папка с данными не найдена: ${SOURCE_DIR}`);
        console.error('Используйте --source для указания другой папки или создайте папку с данными.\n');
        process.exit(1);
    }
    
    // Display directories being used
    console.log('📁 Папка с данными:', SOURCE_DIR);
    console.log('📁 Папка для отчета:', OUTPUT_DIR);
    console.log('');
    
    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    // Load data
    console.log('Загрузка имен студентов...');
    const studentNames = loadStudentNames();
    
    console.log('Загрузка информации о занятиях...');
    const meetings = loadCourseMeetings();
    
    console.log('Загрузка записей о посещаемости...');
    const attendanceRecords = loadAttendanceRecords();
    
    // Calculate statistics
    console.log('\nПостроение матрицы посещаемости...');
    const { attendanceMatrix, sortedMeetings, studentStats } = buildAttendanceMatrix(attendanceRecords, meetings);
    console.log(`Обработано ${studentStats.size} студентов по ${sortedMeetings.length} занятиям`);
    
    // Generate output files
    console.log('\nГенерация HTML отчета...');
    const html = generateHtmlReport(attendanceMatrix, sortedMeetings, studentStats, studentNames);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html);
    
    console.log('Генерация CSS...');
    const css = generateCss();
    fs.writeFileSync(path.join(OUTPUT_DIR, 'styles.css'), css);
    
    console.log('Генерация JavaScript...');
    const js = generateJs();
    fs.writeFileSync(path.join(OUTPUT_DIR, 'script.js'), js);
    
    console.log('\n✅ Отчет успешно создан!');
    console.log(`📁 Папка с выходными данными: ${OUTPUT_DIR}`);
    console.log(`🌐 Откройте ${path.join(OUTPUT_DIR, 'index.html')} в браузере\n`);
    
    // Print summary
    const students = Array.from(studentStats.values());
    const avgAttendance = students.length > 0
        ? students.reduce((sum, s) => sum + parseFloat(s.attendanceRatio), 0) / students.length
        : 0;
    console.log('Сводка:');
    console.log(`  Всего студентов: ${students.length}`);
    console.log(`  Всего занятий: ${sortedMeetings.length}`);
    console.log(`  Всего записей: ${attendanceRecords.length}`);
    console.log(`  Средняя посещаемость: ${avgAttendance.toFixed(2)}%`);
}

// Run the program
main();

