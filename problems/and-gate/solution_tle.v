module top(input a, input b, output out);
    reg loop_var;
    initial begin
        loop_var = 0;
        while(1) begin
            loop_var = ~loop_var;
        end
    end
    assign out = a & b;
endmodule