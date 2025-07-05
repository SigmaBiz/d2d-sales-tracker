#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Files to add to Xcode project
const filesToAdd = [
  'D2DNativeMap.swift',
  'D2DNativeMap.m',
  'D2DNativeMapView.swift',
  'D2DNativeMapView.m',
  'D2DMapView.swift'
];

const projectPath = path.join(__dirname, '../ios/D2DSalesTracker.xcodeproj/project.pbxproj');
const iosPath = path.join(__dirname, '../ios/D2DSalesTracker');

console.log('🔧 Adding native iOS files to Xcode project...');

// Read project file
let projectContent = fs.readFileSync(projectPath, 'utf8');

// Check which files need to be added
const filesToActuallyAdd = filesToAdd.filter(file => {
  const filePath = path.join(iosPath, file);
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${file}`);
    return false;
  }
  if (projectContent.includes(file)) {
    console.log(`✓ Already in project: ${file}`);
    return false;
  }
  console.log(`📁 Will add: ${file}`);
  return true;
});

if (filesToActuallyAdd.length === 0) {
  console.log('✅ All files already in project!');
  process.exit(0);
}

// Use ruby script to add files (React Native's approach)
const rubyScript = `
require 'xcodeproj'

project_path = '${path.join(__dirname, '../ios/D2DSalesTracker.xcodeproj')}'
project = Xcodeproj::Project.open(project_path)

# Find the main group
main_group = project.main_group['D2DSalesTracker']

# Find the target
target = project.targets.find { |t| t.name == 'D2DSalesTracker' }

# Add files
${filesToActuallyAdd.map(file => `
file_ref = main_group.new_file('${file}')
target.source_build_phase.add_file_reference(file_ref) if '${file}'.end_with?('.swift', '.m')
`).join('')}

project.save
`;

// Write ruby script
const rubyScriptPath = path.join(__dirname, 'add-files.rb');
fs.writeFileSync(rubyScriptPath, rubyScript);

try {
  // Check if we have xcodeproj gem
  try {
    execSync('gem list xcodeproj -i', { stdio: 'ignore' });
  } catch {
    console.log('📦 Installing xcodeproj gem...');
    try {
      execSync('gem install xcodeproj --user-install', { stdio: 'inherit' });
    } catch {
      console.log('⚠️  Could not install xcodeproj gem. Trying alternative method...');
    }
  }

  // Run the ruby script
  execSync(`ruby ${rubyScriptPath}`, { stdio: 'inherit' });
  console.log('✅ Files added successfully!');

  // Clean up
  fs.unlinkSync(rubyScriptPath);

  // Update pbxproj to ensure proper configuration
  projectContent = fs.readFileSync(projectPath, 'utf8');
  
  // Ensure Swift files are in the Sources build phase
  if (!projectContent.includes('D2DNativeMap.swift in Sources')) {
    console.log('📝 Updating build phases...');
    
    // Find the Sources section and add our files
    const sourcesMatch = projectContent.match(/\/\* Begin PBXSourcesBuildPhase section \*\/[\s\S]*?files = \(([\s\S]*?)\);/);
    if (sourcesMatch) {
      const currentFiles = sourcesMatch[1];
      const newFiles = filesToActuallyAdd
        .filter(f => f.endsWith('.swift'))
        .map(f => `\t\t\t\t/* ${f} */ /* ${f} in Sources */,`)
        .join('\n');
      
      const updatedFiles = currentFiles + '\n' + newFiles;
      projectContent = projectContent.replace(sourcesMatch[0], sourcesMatch[0].replace(currentFiles, updatedFiles));
      
      fs.writeFileSync(projectPath, projectContent);
    }
  }

  console.log('\n🚀 Next steps:');
  console.log('1. Run: cd ios && pod install');
  console.log('2. Run: cd .. && npx react-native run-ios');

} catch (error) {
  console.error('❌ Error adding files:', error.message);
  fs.unlinkSync(rubyScriptPath);
  process.exit(1);
}