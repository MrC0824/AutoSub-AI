!macro customUnInstall
  ; [关键修改] 先把工作目录切换到系统临时文件夹
  ; 如果不加这一行，卸载程序会占用安装目录，导致最后的空文件夹删不掉
  SetOutPath "$TEMP"

  ; 强制递归删除安装目录下的所有内容
  RMDir /r "$INSTDIR"
!macroend