module tb;
    reg a, b;
    wire out;

    top uut (.a(a), .b(b), .out(out));

    initial begin
        a = 0; b = 0; #10;
        if (out !== 0) begin $display("Failed on Test Case: a=%b, b=%b (Expected 0, Got %b)", a, b, out); $display("[JUDGE_RESULT: WA]"); $finish; end
        
        a = 0; b = 1; #10;
        if (out !== 0) begin $display("Failed on Test Case: a=%b, b=%b (Expected 0, Got %b)", a, b, out); $display("[JUDGE_RESULT: WA]"); $finish; end
        
        a = 1; b = 0; #10;
        if (out !== 0) begin $display("Failed on Test Case: a=%b, b=%b (Expected 0, Got %b)", a, b, out); $display("[JUDGE_RESULT: WA]"); $finish; end
        
        a = 1; b = 1; #10;
        if (out !== 1) begin $display("Failed on Test Case: a=%b, b=%b (Expected 1, Got %b)", a, b, out); $display("[JUDGE_RESULT: WA]"); $finish; end
        
        $display("[JUDGE_RESULT: AC]");
        $finish;
    end
endmodule