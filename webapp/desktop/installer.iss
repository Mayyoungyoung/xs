#ifndef AppVersion
  #define AppVersion "1.1.0"
#endif

[Setup]
AppId=cn.momai.novel.desktop
AppName=墨脉小说创作
AppVersion={#AppVersion}
AppPublisher=Momai
DefaultDirName={localappdata}\Programs\Momai
DefaultGroupName=墨脉小说创作
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\..\desktop-release
OutputBaseFilename=Momai-Setup-{#AppVersion}-x64
SetupIconFile=assets\momai.ico
UninstallDisplayIcon={app}\Momai.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
InfoBeforeFile=installation-notes.txt

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Default.isl"

[LangOptions]
LanguageName=简体中文
LanguageID=$0804

[Messages]
WelcomeLabel1=欢迎安装 [name]
WelcomeLabel2=此向导将在您的电脑上安装 [name/ver]。%n%n您可以选择安装位置。软件安装完成后，可在设置中另外选择小说存储位置。%n%n建议先保存作品并关闭已打开的墨脉软件。
ButtonNext=下一步(&N) >
ButtonBack=< 上一步(&B)
ButtonCancel=取消
ButtonInstall=安装(&I)
ButtonFinish=完成(&F)
ButtonBrowse=浏览(&B)...
SelectDirLabel3=请选择墨脉的安装文件夹，可以选择 D 盘等位置。
SelectDirBrowseLabel=点击“浏览”选择其他位置，然后点击“下一步”。
WizardSelectDir=选择安装位置
SelectDirDesc=您希望把 [name] 安装在哪里？
WizardSelectTasks=选择快捷方式
SelectTasksDesc=您希望创建哪些快捷方式？
SelectTasksLabel2=选择需要的快捷方式，然后点击“下一步”。
WizardReady=准备安装
ReadyLabel1=现在可以开始在您的电脑上安装 [name]。
ReadyLabel2a=点击“安装”开始；点击“上一步”更改安装位置。
ReadyMemoDir=安装位置：
ReadyMemoTasks=快捷方式：
WizardInstalling=正在安装
InstallingLabel=正在安装 [name]，请稍候。
FinishedHeadingLabel=[name] 安装完成
FinishedLabelNoIcons=软件已安装完成。您可以通过安装文件夹启动软件。
FinishedLabel=软件已安装完成。您可以通过桌面或开始菜单图标启动软件。
ClickFinish=点击“完成”退出安装向导。
WizardInfoBefore=安装与存储说明
InfoBeforeLabel=请阅读以下说明，然后点击“下一步”。
InfoBeforeClickLabel=小说资料与软件安装位置相互独立。

[Tasks]
Name: "desktopicon"; Description: "创建桌面图标"; GroupDescription: "快捷方式："

[Files]
Source: "..\..\desktop-release\Momai-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\墨脉小说创作"; Filename: "{app}\Momai.exe"; WorkingDir: "{app}"; AppUserModelID: "cn.momai.novel.desktop"
Name: "{autodesktop}\墨脉小说创作"; Filename: "{app}\Momai.exe"; WorkingDir: "{app}"; Tasks: desktopicon; AppUserModelID: "cn.momai.novel.desktop"

[Run]
Filename: "{app}\Momai.exe"; Description: "打开墨脉小说创作"; Flags: nowait postinstall skipifsilent

; No user data directory is included in the installer or uninstall deletion list.
