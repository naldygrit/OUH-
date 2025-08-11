const fs = require('fs');
const path = require('path');

console.log('🔍 Checking for existing Solana integration...\n');

// Files and directories to check
const checkPaths = [
  'src/services',
  'src/components', 
  'src/types',
  'package.json',
  '.env',
  '.env.local',
  'backend',
  'server'
];

// Solana-related terms to search for
const solanaTerms = [
  'solana',
  '@solana/web3.js',
  '@solana/spl-token',
  'PublicKey',
  'Connection',
  'Keypair',
  'Transaction',
  'SystemProgram',
  'LAMPORTS_PER_SOL',
  'clusterApiUrl',
  'sendAndConfirmTransaction'
];

let foundSolana = false;
const findings = [];

function searchInFile(filePath, content) {
  const matches = [];
  solanaTerms.forEach(term => {
    if (content.toLowerCase().includes(term.toLowerCase())) {
      matches.push(term);
    }
  });
  return matches;
}

function scanDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  
  const files = fs.readdirSync(dirPath, { withFileTypes: true });
  
  files.forEach(file => {
    const fullPath = path.join(dirPath, file.name);
    
    if (file.isDirectory()) {
      scanDirectory(fullPath);
    } else if (file.isFile() && (
      file.name.endsWith('.js') || 
      file.name.endsWith('.ts') || 
      file.name.endsWith('.tsx') || 
      file.name.endsWith('.json')
    )) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const matches = searchInFile(fullPath, content);
        
        if (matches.length > 0) {
          foundSolana = true;
          findings.push({
            file: fullPath,
            matches: matches
          });
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }
  });
}

// Check package.json for Solana dependencies
function checkPackageJson() {
  const packagePaths = ['package.json', 'backend/package.json', 'server/package.json'];
  
  packagePaths.forEach(pkgPath => {
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies
        };
        
        const solanaDeps = Object.keys(allDeps).filter(dep => 
          dep.includes('solana') || dep.includes('SPL')
        );
        
        if (solanaDeps.length > 0) {
          foundSolana = true;
          findings.push({
            file: pkgPath,
            matches: solanaDeps
          });
        }
      } catch (error) {
        // Skip invalid JSON
      }
    }
  });
}

// Run checks
checkPackageJson();
checkPaths.forEach(checkPath => {
  if (fs.existsSync(checkPath)) {
    if (fs.statSync(checkPath).isDirectory()) {
      scanDirectory(checkPath);
    } else {
      try {
        const content = fs.readFileSync(checkPath, 'utf8');
        const matches = searchInFile(checkPath, content);
        if (matches.length > 0) {
          foundSolana = true;
          findings.push({
            file: checkPath,
            matches: matches
          });
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }
  }
});

// Display results
if (foundSolana) {
  console.log('✅ SOLANA INTEGRATION FOUND!\n');
  console.log('📄 Files with Solana references:');
  findings.forEach(finding => {
    console.log(`\n📁 ${finding.file}`);
    console.log(`   🔍 Found: ${finding.matches.join(', ')}`);
  });
} else {
  console.log('❌ NO SOLANA INTEGRATION DETECTED');
  console.log('\n🔍 Searched for:');
  console.log(`   • Solana packages in package.json`);
  console.log(`   • Solana imports and code`);
  console.log(`   • Web3.js and SPL token references`);
  console.log(`   • Solana wallet and transaction code`);
}

console.log('\n' + '='.repeat(50));
console.log(foundSolana ? 
  '🎯 RESULT: Solana is already integrated' : 
  '🎯 RESULT: Solana is NOT integrated yet'
);
console.log('='.repeat(50));
