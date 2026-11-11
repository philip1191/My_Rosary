const creditsDialog=document.getElementById('creditsDialog');
document.getElementById('openCredits').addEventListener('click',()=>creditsDialog.showModal());
document.getElementById('closeCredits').addEventListener('click',()=>creditsDialog.close());
creditsDialog.addEventListener('click',event=>{if(event.target===creditsDialog)creditsDialog.close()});
